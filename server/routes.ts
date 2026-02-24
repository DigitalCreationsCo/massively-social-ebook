import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { generateStoryBlock, generateStoryImage } from "./ai";
import { api } from "@shared/routes";
import { WS_EVENTS, type WsMessage, type Block } from "@shared/schema";

interface ChannelState {
  currentPhase: 'reading' | 'voting';
  phaseEndsAt: number;
  currentBlock: Block | undefined;
}

type Channel = 'scifi' | 'mystery';
const CHANNELS: Channel[] = [ 'scifi', 'mystery' ];

const state: Record<Channel, ChannelState> = {
  scifi: { currentPhase: 'reading', phaseEndsAt: Date.now() + 120000, currentBlock: undefined },
  mystery: { currentPhase: 'reading', phaseEndsAt: Date.now() + 120000, currentBlock: undefined }
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Seed initial blocks if DB is empty for channels
  for (const channelId of CHANNELS) {
    let block = await storage.getCurrentBlock(channelId);
    if (!block) {
      const initialPrompt = channelId === 'scifi'
        ? "We are a crew onboard a spaceship to Mars."
        : "A detective is following a lead in a rainy alleyway.";

      try {
        const nextContent = await generateStoryBlock(channelId, initialPrompt);
        const imageUrl = await generateStoryImage(nextContent.content);

        block = await storage.createBlock({
          channelId,
          ...nextContent,
          imageUrl
        });
      } catch (err) {
        console.error("Failed initial seed:", err);
      // Fallback for robust error handling
        block = await storage.createBlock({
          channelId,
          title: "System Reboot",
          content: "The story system encountered an anomaly and is attempting to reboot.",
          imageUrl: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2000&auto=format&fit=crop",
          optionA: { label: "Reboot", description: "Attempt a system reboot." },
          optionB: { label: "Wait", description: "Wait for the anomaly to clear." }
        });
      }
    }
    state[channelId].currentBlock = block;
  }

  // REST API
  app.get(api.blocks.current.path, async (req, res) => {
    const channelId = req.query.channelId as Channel;
    const channelState = state[channelId];
    if (!channelState || !channelState.currentBlock) {
      return res.status(404).json({ message: "No block found" });
    }
    
    res.json({
      ...channelState.currentBlock,
      createdAt: channelState.currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
      phase: channelState.currentPhase,
      timeRemaining: Math.max(0, channelState.phaseEndsAt - Date.now())
    });
  });

  app.get(api.chat.history.path, async (req, res) => {
    const channelId = req.query.channelId as Channel;
    const messages = await storage.getRecentChat(channelId, 50);
    // Reverse so newest is at the bottom
    res.json(messages.reverse().map(m => ({
      ...m,
      createdAt: m.createdAt?.toISOString() ?? new Date().toISOString()
    })));
  });

  // WebSocket Setup
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Map to store which channel a client is connected to
  const clientChannels = new Map<WebSocket, Channel>();

  function broadcast(channelId: Channel, message: WsMessage) {
    const payload = JSON.stringify(message);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && clientChannels.get(client) === channelId) {
        client.send(payload);
      }
    });
  }

  wss.on('connection', (ws, req) => {
    // Determine channel from URL query string if possible, default to mystery
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const channelId = url.searchParams.get('channelId') as Channel || 'mystery';
    clientChannels.set(ws, channelId);

    const channelState = state[channelId];

    // Send initial state on connect
    if (channelState && channelState.currentBlock) {
      ws.send(JSON.stringify({
        type: WS_EVENTS.SYNC_STATE,
        payload: {
          ...channelState.currentBlock,
          createdAt: channelState.currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
          phase: channelState.currentPhase,
          timeRemaining: Math.max(0, channelState.phaseEndsAt - Date.now())
        }
      }));
    }

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage;
        const currentChannelId = clientChannels.get(ws) || 'mystery';
        const st = state[currentChannelId];
        
        if (message.type === WS_EVENTS.SUBMIT_CHAT) {
          const { username, text } = message.payload as { username: string, text: string };
          if (username && text) {
            const newMsg = await storage.createChat({ channelId: currentChannelId, username, text });
            broadcast(currentChannelId, {
              type: WS_EVENTS.CHAT_MESSAGE,
              payload: {
                ...newMsg,
                createdAt: newMsg.createdAt?.toISOString() ?? new Date().toISOString()
              }
            });
          }
        } else if (message.type === WS_EVENTS.SUBMIT_VOTE) {
          const { choice, userId } = message.payload as { choice: string, userId: string };
          if (st.currentPhase === 'voting' && st.currentBlock && (choice === 'A' || choice === 'B')) {
            await storage.createVote({
              channelId: currentChannelId,
              blockId: st.currentBlock.id,
              userId: userId || `anon-${Math.random()}`,
              choice
            });
            // We can broadcast a vote update if we want real-time percentages
            const votes = await storage.getVotesForBlock(st.currentBlock.id);
            const countA = votes.filter(v => v.choice === 'A').length;
            const countB = votes.filter(v => v.choice === 'B').length;
            broadcast(currentChannelId, {
              type: WS_EVENTS.VOTE_UPDATE,
              payload: { A: countA, B: countB }
            });
          }
        }
      } catch (err) {
        console.error("WS message error", err);
      }
    });

    ws.on('close', () => {
      clientChannels.delete(ws);
    });
  });

  // Game Loop
  setInterval(async () => {
    const now = Date.now();
    
    for (const channelId of CHANNELS) {
      const st = state[channelId];
      if (!st) continue;
      
      if (now >= st.phaseEndsAt) {
        if (st.currentPhase === 'reading') {
          st.currentPhase = 'voting';
          st.phaseEndsAt = now + 30000; // 30 seconds for voting
        } else {
          // Tally votes and generate next block
          st.currentPhase = 'reading';
          st.phaseEndsAt = now + 120000; // 2 minutes for reading
          
          if (st.currentBlock) {
            const votes = await storage.getVotesForBlock(st.currentBlock.id);
            const countA = votes.filter(v => v.choice === 'A').length;
            const countB = votes.filter(v => v.choice === 'B').length;
            
            const winner = countA >= countB ? 'A' : 'B';
            
            const optA = st.currentBlock.optionA as { label?: string, description?: string; } | null;
            const optB = st.currentBlock.optionB as { label?: string, description?: string; } | null;

            const winnerText = winner === 'A'
              ? `${optA?.label || 'Choice A'}: ${optA?.description || 'The readers chose option A'}`
              : `${optB?.label || 'Choice B'}: ${optB?.description || 'The readers chose option B'}`;

            const previousContext = `Previous event: ${st.currentBlock.content}\nThe readers chose: ${winnerText}`;

            try {
              const nextContent = await generateStoryBlock(channelId, previousContext);
              const imageUrl = await generateStoryImage(nextContent.content);

              st.currentBlock = await storage.createBlock({
                channelId,
                ...nextContent,
                imageUrl
              });
            } catch (err) {
              console.error("Failed to generate next block:", err);
            // Fallback
              st.currentBlock = await storage.createBlock({
                channelId,
                title: "Temporal Distortion",
                content: "A temporal distortion disrupts the timeline. We must re-establish connection.",
                imageUrl: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2000&auto=format&fit=crop",
                optionA: { label: "Reconnect", description: "Attempt to reconnect to the timeline." },
                optionB: { label: "Wait", description: "Wait for the distortion to pass." }
              });
            }
          }
        }

        if (st.currentBlock) {
          broadcast(channelId, {
            type: WS_EVENTS.SYNC_STATE,
            payload: {
              ...st.currentBlock,
              createdAt: st.currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
              phase: st.currentPhase,
              timeRemaining: Math.max(0, st.phaseEndsAt - Date.now())
            }
          });
        }
      } else {
        // Send time updates every second to keep clients perfectly in sync
        if (st.currentBlock) {
          broadcast(channelId, {
            type: WS_EVENTS.SYNC_STATE,
            payload: {
              ...st.currentBlock,
              createdAt: st.currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
              phase: st.currentPhase,
              timeRemaining: Math.max(0, st.phaseEndsAt - Date.now())
            }
          });
        }
      }
    }
  }, 1000);

  return httpServer;
}
