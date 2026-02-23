import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { WS_EVENTS, type WsMessage, type Block } from "@shared/schema";

interface ChannelState {
  currentPhase: 'reading' | 'voting';
  phaseEndsAt: number;
  currentBlock: Block | undefined;
}

const CHANNELS = ['scifi', 'gothic'];

const state: Record<string, ChannelState> = {
  scifi: { currentPhase: 'reading', phaseEndsAt: Date.now() + 120000, currentBlock: undefined },
  gothic: { currentPhase: 'reading', phaseEndsAt: Date.now() + 120000, currentBlock: undefined }
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Seed initial blocks if DB is empty for channels
  for (const channelId of CHANNELS) {
    let block = await storage.getCurrentBlock(channelId);
    if (!block) {
      if (channelId === 'scifi') {
        block = await storage.createBlock({
          channelId: 'scifi',
          title: "The Breach",
          content: "The spaceship's hull groaned under the pressure. Alarms blared, bathing the corridor in a harsh, pulsing red light. Commander Vance had a split second to make a decision that would determine the fate of the entire crew.",
          imageUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop",
          optionA: { label: "Manual Override", description: "Slam the manual override to seal the airlock, trapping the breach but sealing off the engineering bay." },
          optionB: { label: "Route Power", description: "Route all power to the shields. The engines will die, but the hull might stop tearing." }
        });
      } else {
        block = await storage.createBlock({
          channelId: 'gothic',
          title: "The Alley",
          content: "Rain hammered the cobblestones in sheets, each drop a tiny detonation of light beneath the gas lamps. Elena pressed herself into the doorway of a shuttered bookshop, her coat already soaked through. Somewhere ahead, past the narrow bend where the alley swallowed itself, a door had slammed.",
          imageUrl: "https://images.unsplash.com/photo-1505672678657-cc70370f6e93?q=80&w=2000&auto=format&fit=crop",
          optionA: { label: "Follow the Sound", description: "Step out into the rain and run toward where the door slammed." },
          optionB: { label: "Wait it Out", description: "Stay hidden in the doorway and wait to see if anyone approaches." }
        });
      }
    }
    state[channelId].currentBlock = block;
  }

  // REST API
  app.get(api.blocks.current.path, async (req, res) => {
    const channelId = (req.query.channelId as string) || 'scifi';
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
    const channelId = (req.query.channelId as string) || 'scifi';
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
  const clientChannels = new Map<WebSocket, string>();

  function broadcast(channelId: string, message: WsMessage) {
    const payload = JSON.stringify(message);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && clientChannels.get(client) === channelId) {
        client.send(payload);
      }
    });
  }

  wss.on('connection', (ws, req) => {
    // Determine channel from URL query string if possible, default to scifi
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const channelId = url.searchParams.get('channelId') || 'scifi';
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
        const currentChannelId = clientChannels.get(ws) || 'scifi';
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
            
            if (channelId === 'scifi') {
              const nextContent = winner === 'A' 
                ? "Vance slammed his fist onto the manual override. The airlock sealed, trapping the breach but sealing off the engineering bay. The ship shuddered, stabilizing."
                : "Vance routed all power to the shields. The engines died immediately, leaving them adrift, but the hull stopped tearing. The silence that followed was deafening.";
                
              st.currentBlock = await storage.createBlock({
                channelId,
                title: "The Aftermath",
                content: nextContent,
                imageUrl: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?q=80&w=2072&auto=format&fit=crop",
                optionA: { label: "Investigate", description: "Send a drone to investigate the damage." },
                optionB: { label: "Wait", description: "Wait for rescue signals." }
              });
            } else {
              const nextContent = winner === 'A'
                ? "She stepped out, the rain instantly plastering her hair to her face. As she reached the corner where the door had slammed, she saw nothing but an empty dead end."
                : "She waited, her breath pluming in the cold air. Minutes passed. The only sound was the rain, until a shadow detached itself from the wall across the street.";
              
              st.currentBlock = await storage.createBlock({
                channelId,
                title: "The Next Step",
                content: nextContent,
                imageUrl: "https://images.unsplash.com/photo-1518331647614-7a1f04cd34cf?q=80&w=2069&auto=format&fit=crop",
                optionA: { label: "Call Out", description: "Shout into the darkness." },
                optionB: { label: "Run Away", description: "Turn and run back the way she came." }
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
