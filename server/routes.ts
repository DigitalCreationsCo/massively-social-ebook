import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { generateStoryBlock, generateStoryImage } from "./ai";
import { api } from "@shared/routes";
import { WS_EVENTS, type WsMessage, type Block } from "@shared/schema";
import { getRealChannelId, getObfuscatedChannelId, CHANNELS, type Channel } from "@shared/channels";

interface PendingBlock {
  promise: Promise<{
    title: string;
    content: string;
    imageUrl: string;
    optionA: unknown;
    optionB: unknown;
  }>;
}

// Phase duration constants (milliseconds)
export const NARRATIVE_TURN_MS = 80_000;
export const VOTING_PHASE_MS = 40_000;
export const POST_VOTE_READING_MS = 120_000;

interface ChannelState {
  currentPhase: 'reading' | 'voting';
  phaseEndsAt: number;
  decisionEndsAt: number;
  initialTimeToDecision: number;
  currentBlock: Block | undefined;
  nextBlockA?: PendingBlock;
  nextBlockB?: PendingBlock;
  turnsToNextChoice: number;
}

/** Compute wall-clock time when the next decision (voting) phase begins. */
export function computeDecisionEndsAt(st: ChannelState): number {
  if (st.currentPhase === 'voting') return st.phaseEndsAt; // already in decision
  return st.phaseEndsAt + (st.turnsToNextChoice * NARRATIVE_TURN_MS);
}

export const state: Record<Channel, ChannelState> = {
  scifi: { currentPhase: 'reading', phaseEndsAt: Date.now() + POST_VOTE_READING_MS, decisionEndsAt: 0, initialTimeToDecision: 0, currentBlock: undefined, turnsToNextChoice: 3 },
  mystery: { currentPhase: 'reading', phaseEndsAt: Date.now() + POST_VOTE_READING_MS, decisionEndsAt: 0, initialTimeToDecision: 0, currentBlock: undefined, turnsToNextChoice: 3 }
};

function getRandomTurns() {
  return Math.floor(Math.random() * 3) + 2; // 2, 3, or 4
}

function pregenerateOption(channelId: Channel, st: ChannelState, option: 'A' | 'B') {
  if (!st.currentBlock) return;
  const opt = option === 'A' ? st.currentBlock.optionA : st.currentBlock.optionB;
  const optData = opt as { label?: string, description?: string; } | null;
  const winnerText = `${optData?.label || `Choice ${option}`}: ${optData?.description || `The readers chose option ${option}`}`;
  const previousContext = `Previous event: ${st.currentBlock.content}\nThe readers chose: ${winnerText}`;

  const promise = (async () => {
    try {
      const nextContent = await generateStoryBlock(channelId, previousContext);
      let imageUrl: string;
      try {
        imageUrl = await generateStoryImage(nextContent.content);
      } catch (imageErr) {
        console.warn(`Image generation failed for ${channelId}, using fallback:`, imageErr);
        imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
      }
      return { ...nextContent, imageUrl };
    } catch (err) {
      console.error(`Failed to pregenerate option ${option} for ${channelId}:`, err);
      // Fallback
      return {
        title: "Temporal Distortion",
        content: "A temporal distortion disrupts the timeline. We must re-establish connection.",
        imageUrl: "/images/img_1771936309521_ieycq2.jpg",
        optionA: { label: "Reconnect", description: "Attempt to reconnect to the timeline." },
        optionB: { label: "Wait", description: "Wait for the distortion to pass." }
      };
    }
  })();

  if (option === 'A') {
    st.nextBlockA = { promise };
  } else {
    st.nextBlockB = { promise };
  }
}

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
        let imageUrl: string;
        try {
          imageUrl = await generateStoryImage(nextContent.content);
        } catch (imageErr) {
          console.warn(`Initial seed image generation failed for ${channelId}, using fallback:`, imageErr);
          imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
        }

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
          imageUrl: "/images/img_1771936309521_ieycq2.jpg",
          optionA: { label: "Reboot", description: "Attempt a system reboot." },
          optionB: { label: "Wait", description: "Wait for the anomaly to clear." }
        });
      }
    }
    state[channelId].currentBlock = block;
    state[ channelId ].turnsToNextChoice = getRandomTurns();
    state[ channelId ].decisionEndsAt = computeDecisionEndsAt(state[ channelId ]);
    state[ channelId ].initialTimeToDecision = Math.max(0, state[ channelId ].decisionEndsAt - Date.now());
    // Kick off background generation for the initial block
    pregenerateOption(channelId, state[ channelId ], 'A');
    pregenerateOption(channelId, state[ channelId ], 'B');
  }

  // REST API
  app.get(api.blocks.current.path, async (req, res) => {
    const rawChannelId = req.query.channelId as string;
    const channelId = getRealChannelId(rawChannelId) as Channel;
    const channelState = state[channelId];
    if (!channelState || !channelState.currentBlock) {
      return res.status(404).json({ message: "No block found" });
    }
    
    const now = Date.now();
    res.json({
      ...channelState.currentBlock,
      createdAt: channelState.currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
      phase: channelState.currentPhase,
      timeRemaining: Math.max(0, channelState.phaseEndsAt - now),
      timeToNextDecision: Math.max(0, channelState.decisionEndsAt - now),
      initialTimeToNextDecision: channelState.initialTimeToDecision,
      turnsToNextChoice: channelState.turnsToNextChoice
    });
  });

  app.get(api.chat.history.path, async (req, res) => {
    const rawChannelId = req.query.channelId as string;
    const channelId = getRealChannelId(rawChannelId) as Channel;
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
    const rawChannelId = url.searchParams.get('channelId');
    const channelId = getRealChannelId(rawChannelId) as Channel;
    clientChannels.set(ws, channelId);

    const channelState = state[channelId];

    // Send initial state on connect
    if (channelState && channelState.currentBlock) {
      const connectNow = Date.now();
      ws.send(JSON.stringify({
        type: 'SYNC_STATE',
        payload: {
          ...channelState.currentBlock,
          createdAt: channelState.currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
          phase: channelState.currentPhase,
          timeRemaining: Math.max(0, channelState.phaseEndsAt - connectNow),
          timeToNextDecision: Math.max(0, channelState.decisionEndsAt - connectNow),
          initialTimeToNextDecision: channelState.initialTimeToDecision,
          turnsToNextChoice: channelState.turnsToNextChoice
        }
      }));
    }

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage;
        const currentChannelId = clientChannels.get(ws) || 'mystery';
        const st = state[currentChannelId];
        
        if (message.type === 'SUBMIT_CHAT') {
          const { username, text } = message.payload as { username: string, text: string };
          if (username && text) {
            const newMsg = await storage.createChat({ channelId: currentChannelId, username, text });
            broadcast(currentChannelId, {
              type: 'CHAT_MESSAGE',
              payload: {
                ...newMsg,
                createdAt: newMsg.createdAt?.toISOString() ?? new Date().toISOString()
              }
            });
          }
        } else if (message.type === 'SUBMIT_VOTE') {
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
              type: 'VOTE_UPDATE',
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
    await handleGameLoopTick(Date.now(), broadcast);
  }, 1000);

  return httpServer;
}

export async function handleGameLoopTick(now: number, broadcast: (channelId: Channel, message: WsMessage) => void) {
  for (const channelId of CHANNELS) {
    const st = state[ channelId ];
    if (!st) continue;

    if (now >= st.phaseEndsAt) {
      if (st.currentPhase === 'reading') {
        if (st.turnsToNextChoice > 0) {
          // Narrative turn: skip voting, go straight to next block
          st.turnsToNextChoice--;
          st.phaseEndsAt = now + NARRATIVE_TURN_MS;
          st.decisionEndsAt = computeDecisionEndsAt(st);
          // CRITICAL FIX: Update initialTimeToDecision so the progress bar is accurate for the current narrative sequence
          st.initialTimeToDecision = Math.max(0, st.decisionEndsAt - now);

          console.log(`[GameLoop] ${channelId}: Narrative turn. Turns remaining: ${st.turnsToNextChoice}, Next phase ends at: ${new Date(st.phaseEndsAt).toLocaleTimeString()}, Total decision cycle time: ${st.initialTimeToDecision / 1000}s`);

          // Advance story using option A as default for narrative progression
          if (st.currentBlock) {
            try {
              let nextData;
              if (st.nextBlockA) {
                nextData = await st.nextBlockA.promise;
              } else {
                // Fallback if pregeneration didn't happen
                const opt = st.currentBlock.optionA;
                const optData = opt as { label?: string, description?: string; } | null;
                const winnerText = `${optData?.label || 'Choice A'}: ${optData?.description || 'The story continues...'}`;
                const previousContext = `${st.currentBlock.title}\n${st.currentBlock.content}${winnerText}`;
                const nextContent = await generateStoryBlock(channelId, previousContext);
                let imageUrl: string;
                try {
                  imageUrl = await generateStoryImage(nextContent.content);
                } catch (imageErr) {
                  imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
                }
                nextData = { ...nextContent, imageUrl };
              }

              st.currentBlock = await storage.createBlock({
                channelId,
                ...nextData
              } as any);

              // Clear used pregenerated blocks
              st.nextBlockA = undefined;
              st.nextBlockB = undefined;

              pregenerateOption(channelId, st, 'A');
              pregenerateOption(channelId, st, 'B');
              console.log(`[GameLoop] ${channelId}: Advanced story to block ${st.currentBlock.id}`);
            } catch (err) {
              console.error("Failed to advance narrative:", err);
            }
          }
        } else {
        // Choice turn: enter voting phase
          st.currentPhase = 'voting';
          st.phaseEndsAt = now + VOTING_PHASE_MS;
          st.decisionEndsAt = computeDecisionEndsAt(st);
          st.initialTimeToDecision = Math.max(0, st.decisionEndsAt - now);
          console.log(`[GameLoop] ${channelId}: ENTERING VOTING PHASE. Ends at: ${new Date(st.phaseEndsAt).toLocaleTimeString()}`);
        }
      } else {
        // Voting phase ended: tally votes and generate next block
        st.currentPhase = 'reading';
        st.phaseEndsAt = now + POST_VOTE_READING_MS;
        st.turnsToNextChoice = getRandomTurns();
        st.decisionEndsAt = computeDecisionEndsAt(st);
        st.initialTimeToDecision = Math.max(0, st.decisionEndsAt - now);
        console.log(`[GameLoop] ${channelId}: VOTING ENDED. Starting reading phase with ${st.turnsToNextChoice} turns. Overall ends at: ${new Date(st.decisionEndsAt).toLocaleTimeString()}`);

        if (st.currentBlock) {
          const votes = await storage.getVotesForBlock(st.currentBlock.id);
          const countA = votes.filter(v => v.choice === 'A').length;
          const countB = votes.filter(v => v.choice === 'B').length;

          const winner = countA >= countB ? 'A' : 'B';

          try {
            let nextData;
            if (winner === 'A' && st.nextBlockA) {
              nextData = await st.nextBlockA.promise;
            } else if (winner === 'B' && st.nextBlockB) {
              nextData = await st.nextBlockB.promise;
            } else {
              const opt = winner === 'A' ? st.currentBlock.optionA : st.currentBlock.optionB;
              const optData = opt as { label?: string, description?: string; } | null;
              const winnerText = `${optData?.label || `Choice ${winner}`}: ${optData?.description || `The readers chose option ${winner}`}`;
              const previousContext = `Previous event: ${st.currentBlock.content}\nThe readers chose: ${winnerText}`;
              const nextContent = await generateStoryBlock(channelId, previousContext);
              let imageUrl: string;
              try {
                imageUrl = await generateStoryImage(nextContent.content);
              } catch (imageErr) {
                console.warn(`Game loop image generation failed for ${channelId}, using fallback:`, imageErr);
                imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
              }
              nextData = { ...nextContent, imageUrl };
            }

            st.currentBlock = await storage.createBlock({
              channelId,
              ...nextData
            } as any);

            // Clear used pregenerated blocks
            st.nextBlockA = undefined;
            st.nextBlockB = undefined;

            pregenerateOption(channelId, st, 'A');
            pregenerateOption(channelId, st, 'B');
          } catch (err) {
            console.error("Failed to adopt next block:", err);
            // Fallback
            st.currentBlock = await storage.createBlock({
              channelId,
              title: "Temporal Distortion",
              content: "A temporal distortion disrupts the timeline. We must re-establish connection.",
              imageUrl: "/images/img_1771936309521_ieycq2.jpg",
              optionA: { label: "Reconnect", description: "Attempt to reconnect to the timeline." },
              optionB: { label: "Wait", description: "Wait for the distortion to pass." }
            });

            pregenerateOption(channelId, st, 'A');
            pregenerateOption(channelId, st, 'B');
          }
        }
      }

      if (st.currentBlock) {
        broadcast(channelId, {
          type: 'SYNC_STATE',
          payload: {
            ...st.currentBlock,
            createdAt: st.currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
            phase: st.currentPhase,
            timeRemaining: Math.max(0, st.phaseEndsAt - now),
            timeToNextDecision: Math.max(0, st.decisionEndsAt - now),
            initialTimeToNextDecision: st.initialTimeToDecision,
            turnsToNextChoice: st.turnsToNextChoice
          }
        });
      }
    } else {
      // Send time updates every second to keep clients perfectly in sync
      if (st.currentBlock) {
        broadcast(channelId, {
          type: 'SYNC_STATE',
          payload: {
            ...st.currentBlock,
            createdAt: st.currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
            phase: st.currentPhase,
            timeRemaining: Math.max(0, st.phaseEndsAt - now),
            timeToNextDecision: Math.max(0, st.decisionEndsAt - now),
            initialTimeToNextDecision: st.initialTimeToDecision,
            turnsToNextChoice: st.turnsToNextChoice
          }
        });
      }
    }
  }
}
