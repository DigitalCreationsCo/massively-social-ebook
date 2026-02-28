import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { generateStoryBlock, generateStoryImage } from "./ai";
import { api } from "@shared/routes";
import { WS_EVENTS, type WsMessage, type Block, type Session } from "@shared/schema";
import { getRealChannelId, getObfuscatedChannelId, CHANNELS, type Channel } from "@shared/channels";
import { trackUserEmail } from "./analytics";
import { CalendarService } from "./calendar";
import { isAdmin, isDevOnly } from "./middleware/auth";
import { logger } from "./logger";

import { formatMST } from "@shared/date";
interface PendingBlock {
  promise: Promise<{
    title: string;
    content: string;
    imageUrl: string;
    optionA?: unknown;
    optionB?: unknown;
  }>;
}

// Phase duration constants (milliseconds)
export const NARRATIVE_TURN_MS = 40_000;
export const VOTING_PHASE_MS = 40_000;
export const POST_VOTE_READING_MS = 40_000;

interface ChannelState {
  currentPhase: 'reading' | 'voting' | 'resolution';
  phaseEndsAt: number;
  decisionEndsAt: number;
  initialTimeToDecision: number;
  currentBlock: Block | undefined;
  nextBlockA?: PendingBlock;
  nextBlockB?: PendingBlock;
  turnsToNextChoice: number;
  activeSession?: Session;
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
        logger.warn(`Image generation failed for ${channelId}, using fallback`, "ai", imageErr);
        imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
      }
      return { ...nextContent, imageUrl };
    } catch (err) {
      logger.error(`Failed to pregenerate option ${option} for ${channelId}`, "routes", err instanceof Error ? err : new Error(String(err)));
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

async function startSessionForChannel(channelId: Channel, session: Session, broadcast: (channelId: Channel, message: WsMessage) => void) {
  logger.info(`Starting session "${session.title}" for channel ${channelId}`, "session");
  const st = state[ channelId ];
  st.activeSession = session;
  
  // Seed or resume block
  let block = await storage.getCurrentBlock(channelId);
  if (!block) {
    const initialPrompt = channelId === 'scifi'
      ? "We are a crew onboard a spaceship to Mars."
      : "A detective is following a lead in a rainy alleyway.";

    try {
      const nextContent = await generateStoryBlock(channelId, initialPrompt, false);
      let imageUrl: string;
      try {
        imageUrl = await generateStoryImage(nextContent.content);
      } catch (imageErr) {
        imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
      }
      block = await storage.createBlock({ channelId, ...nextContent, imageUrl });
    } catch (err) {
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

  st.currentBlock = block;
  st.currentPhase = 'reading';
  st.phaseEndsAt = Date.now() + POST_VOTE_READING_MS;
  st.turnsToNextChoice = getRandomTurns();
  st.decisionEndsAt = computeDecisionEndsAt(st);
  st.initialTimeToDecision = Math.max(0, st.decisionEndsAt - Date.now());

  pregenerateOption(channelId, st, 'A');
  pregenerateOption(channelId, st, 'B');

  await storage.updateSessionStatus(session.id, 'active');

  broadcast(channelId, {
    type: 'SESSION_STATUS',
    payload: { status: 'active', session }
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Static state seeding (now managed by sessions, but we can keep basic init)
  for (const channelId of CHANNELS) {
    const active = await storage.getActiveSession(channelId);
    if (active) {
      state[ channelId ].activeSession = active;
      state[ channelId ].currentBlock = await storage.getCurrentBlock(channelId);
      state[ channelId ].decisionEndsAt = computeDecisionEndsAt(state[ channelId ]);
      state[ channelId ].initialTimeToDecision = Math.max(0, state[ channelId ].decisionEndsAt - Date.now());
      pregenerateOption(channelId, state[ channelId ], 'A');
      pregenerateOption(channelId, state[ channelId ], 'B');
    }
  }

  // Session Endpoints
  app.get(api.sessions.next.path, async (req, res) => {
    const rawChannelId = req.query.channelId as string;
    const channelId = getRealChannelId(rawChannelId) as Channel;
    // Check active first, then next
    const active = await storage.getActiveSession(channelId);
    if (active) return res.json(active);
    const next = await storage.getNextSession(channelId);
    res.json(next || null);
  });

  app.get('/api/sessions/:id/ics', async (req, res) => {
    const id = parseInt(req.params.id);
    const sessions = await storage.listSessions();
    const session = sessions.find(s => s.id === id);

    if (!session) return res.status(404).send('Session not found');

    const icsContent = CalendarService.generateIcs(session);
    
    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', `attachment; filename="session-${id}.ics"`);
    res.send(icsContent);
  });

  app.post(api.sessions.reminder.path, async (req, res) => {
    const { sessionId, email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    // 1. Persist User (Lead Capture) FIRST - We capture leads even if no session exists
    let user;
    try {
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        user = existing;
      } else {
        user = await storage.createUser({ email });
      }
    } catch (err) {
      logger.error("Failed to persist user", "storage", err instanceof Error ? err : new Error(String(err)));
      // Already logged above
      // Continue anyway to attempt calendar add
    }

    // 2. Capture for Analytics/CRM
    await trackUserEmail(email, 'session_reminder');

    // 3. Try to add to Calendar if session exists
    let session = undefined;
    if (sessionId) {
      const sessionList = await storage.listSessions();
      session = sessionList.find(s => s.id === sessionId);
    }

    if (session) {
      try {
        await Promise.all([
          CalendarService.addToGoogle(email, session),
          CalendarService.addToOutlook(email, session)
        ]);
        res.json({ success: true, message: "Reminders scheduled for Google and Outlook" });
      } catch (err) {
        logger.error("Failed to schedule reminders", "calendar", err instanceof Error ? err : new Error(String(err)));
        // Already logged above
        // Still return success if user was saved, but calendar failed
        res.json({ success: true, message: "You're on the list! (Calendar invites failed)" });
      }
    } else {
      // No session found, but user is saved as 'Global Interest'
      res.json({ success: true, message: "We'll notify you when the next session is scheduled." });
    }
  });
  app.post('/api/notifications/subscribe', async (req, res) => {
    const { email, subscription } = req.body;
    logger.info(`New subscription: ${email}`, "notifications", { subscription });

    if (email) {
      try {
        let user = await storage.getUserByEmail(email);
        const token = JSON.stringify(subscription);
        if (user) {
          await storage.updateUserPushToken(email, token);
        } else {
          await storage.createUser({ email, pushToken: token });
        }
      } catch (err) {

        logger.error("Failed to persist subscription user", "storage", err instanceof Error ? err : new Error(String(err)));
      }
    }

    res.json({ success: true });
  });

  // Admin Endpoints
  app.get(api.admin.sessions.list.path, isAdmin, async (req, res) => {
    const sessions = await storage.listSessions();
    res.json(sessions);
  });

  app.post(api.admin.sessions.create.path, isAdmin, async (req, res) => {
    const { channelId, title, description, scheduledStart, scheduledEnd } = req.body;
    const session = await storage.createSession({
      channelId,
      title,
      description,
      scheduledStart: new Date(scheduledStart),
      scheduledEnd: new Date(scheduledEnd)
    });
    res.status(201).json(session);
  });

  app.patch(api.admin.sessions.cancel.path, isAdmin, async (req, res) => {
    const id = parseInt(String(req.params.id));
    const session = await storage.cancelSession(id);
    res.json(session);
  });

  app.post('/api/debug/sessions/start', isDevOnly, isAdmin, async (req, res) => {
    const { channelId: obfId } = req.body;
    const channelId = getRealChannelId(obfId) as Channel;
    const st = state[ channelId ];

    if (st.activeSession) {
      return res.status(400).json({ success: false, message: "A session is already active for this channel" });
    }

    // Find next scheduled, or create dummy
    let session = await storage.getNextSession(channelId);
    if (!session) {
      session = await storage.createSession({
        channelId,
        title: `Debug Session ${new Date().toISOString()}`,
        description: "Manually triggered debug session",
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 3600000) // 1 hour
      });
    }

    await startSessionForChannel(channelId, session, (cid, msg) => {
      // Broadcast helper inside registerRoutes can be used if we closure it, but we can just use the local broadcast
      const payload = JSON.stringify(msg);
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && clientChannels.get(client) === cid) {
          client.send(payload);
        }
      });
    });

    res.json({ success: true, message: "Session started", session });
  });

  app.post('/api/debug/sessions/skip', isDevOnly, isAdmin, async (req, res) => {
    const { channelId: obfId } = req.body;
    const channelId = getRealChannelId(obfId) as Channel;
    const st = state[ channelId ];

    if (!st.activeSession) {
      return res.status(404).json({ success: false, message: "No active session" });
    }

    logger.debug(`Skipping phase for channel ${channelId}`, "debug");
    st.phaseEndsAt = Date.now(); // Trigger immediate transition on next tick
    res.json({ success: true, message: "Phase skip triggered" });
  });

  app.post('/api/debug/sessions/tally', isDevOnly, isAdmin, async (req, res) => {
    const { channelId: obfId } = req.body;
    const channelId = getRealChannelId(obfId) as Channel;
    const st = state[ channelId ];

    if (!st.activeSession) {
      return res.status(404).json({ success: false, message: "No active session" });
    }

    if (st.currentPhase !== 'voting') {
      return res.status(400).json({ success: false, message: "Not in voting phase" });
    }

    logger.debug(`Forcing tally for channel ${channelId}`, "debug");
    st.phaseEndsAt = Date.now(); // Trigger end of voting phase
    res.json({ success: true, message: "Tally forced" });
  });

  app.post('/api/debug/sessions/narrative', isDevOnly, isAdmin, async (req, res) => {
    const { channelId: obfId } = req.body;
    const channelId = getRealChannelId(obfId) as Channel;
    const st = state[ channelId ];

    if (!st.activeSession) {
      return res.status(404).json({ success: false, message: "No active session" });
    }

    if (st.turnsToNextChoice <= 0) {
      return res.status(400).json({ success: false, message: "Already at decision phase" });
    }

    logger.debug(`Forcing narrative turn for channel ${channelId}`, "debug");
    st.phaseEndsAt = Date.now(); // Trigger next turn
    res.json({ success: true, message: "Narrative turn forced" });
  });

  app.post('/api/debug/sessions/resolve', isDevOnly, isAdmin, async (req, res) => {
    const { channelId: obfId } = req.body;
    const channelId = getRealChannelId(obfId) as Channel;
    const st = state[ channelId ];

    if (st && st.activeSession) {
      logger.debug(`Forcing resolution for channel ${channelId}`, "debug");
      st.activeSession.scheduledEnd = new Date();
      st.phaseEndsAt = Date.now(); // Trigger immediately
      res.json({ success: true, message: "Resolution triggered" });
    } else {
      res.status(404).json({ success: false, message: "No active session for this channel" });
    }
  });

  // REST API
  app.get(api.blocks.current.path, async (req, res) => {
    const rawChannelId = req.query.channelId as string;
    const channelId = getRealChannelId(rawChannelId) as Channel;
    const channelState = state[channelId];
    if (!channelState || !channelState.activeSession || !channelState.currentBlock) {
      return res.status(404).json({ message: "No active session" });
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
    
    let sessionId = state[channelId].activeSession?.id;
    if (!sessionId) {
      const nextSession = await storage.getNextSession(channelId);
      sessionId = nextSession?.id;
    }

    const messages = await storage.getRecentChat(channelId, sessionId, 50);
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
    const debug = url.searchParams.get('debug') === 'true';
    const token = url.searchParams.get('token');

    if (debug) {
      if (token !== process.env.ADMIN_TOKEN && (process.env.NODE_ENV === 'production' || token !== 'dev-token')) {
        logger.warn(`Unauthorized debug access attempt for channel ${rawChannelId}`, "ws");
        ws.close(4001, "Unauthorized focus");
        return;
      }
    }

    const channelId = getRealChannelId(rawChannelId) as Channel;
    clientChannels.set(ws, channelId);

    const channelState = state[channelId];

    // Send initial state on connect
    if (channelState && channelState.activeSession && channelState.currentBlock) {
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
    } else {
      // If no active session, send session status info
      (async () => {
        const next = await storage.getNextSession(channelId);
        ws.send(JSON.stringify({
          type: 'SESSION_STATUS',
          payload: { status: 'scheduled', session: next || null }
        }));
      })();
    }

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage;
        const currentChannelId = clientChannels.get(ws) || 'mystery';
        const st = state[currentChannelId];
        
        if (message.type === 'SUBMIT_CHAT') {
          const { username, text } = message.payload as { username: string, text: string };
          if (username && text) {
            let sessionId = st.activeSession?.id;
            if (!sessionId) {
              const nextSession = await storage.getNextSession(currentChannelId);
              sessionId = nextSession?.id;
            }
            
            // If still no session ID (no upcoming session), we might want to skip or allow global chat?
            // Requirement says "unique to each session". If no session, no chat?
            // Or maybe just create chat without session ID (which will be filtered out by getRecentChat if we follow logic)?
            // I'll create it anyway, but it won't show up in history if sessionId is required for history retrieval.
            
            const newMsg = await storage.createChat({ channelId: currentChannelId, username, text, sessionId });
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
        logger.error("WS message error", "ws", err instanceof Error ? err : new Error(String(err)));
        // Already logged above
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

    // Session Lifecycle Management
    if (!st.activeSession) {
      const next = await storage.getNextSession(channelId);
      if (next && now >= next.scheduledStart.getTime()) {
        await startSessionForChannel(channelId, next, broadcast);
      }
      continue; // Skip game loop if no session is active
    } else if (st.currentPhase !== 'resolution' && now >= st.activeSession.scheduledEnd.getTime()) {
      // Trigger resolution phase instead of abrupt end
      logger.info(`Session "${st.activeSession.title}" for channel ${channelId} reaching scheduled end. Entering resolution.`, "session");
      st.currentPhase = 'resolution';
      st.phaseEndsAt = now + NARRATIVE_TURN_MS;
      st.turnsToNextChoice = 0;
      st.decisionEndsAt = st.phaseEndsAt;
      st.initialTimeToDecision = 0;

      if (st.currentBlock) {
        try {
          const previousContext = `Previous event: ${st.currentBlock.content}`;
          const nextContent = await generateStoryBlock(channelId, previousContext, true);
          let imageUrl;
          try {
            imageUrl = await generateStoryImage(nextContent.content);
          } catch (err) {
            imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
          }
          st.currentBlock = await storage.createBlock({ channelId, ...nextContent, imageUrl });
          logger.info(`Resolution block generated: ${st.currentBlock.id}`, "gameloop");
        } catch (err) {
          logger.error("Failed to generate resolution block", "gameloop", err instanceof Error ? err : new Error(String(err)));
        // Already logged above
        }
      }
    } else if (st.currentPhase === 'resolution' && now >= st.phaseEndsAt) {
      logger.info(`Ending session "${st.activeSession.title}" for channel ${channelId} after resolution.`, "session");
      await storage.updateSessionStatus(st.activeSession.id, 'completed');
      const finishedSession = st.activeSession;
      st.activeSession = undefined;
      broadcast(channelId, {
        type: 'SESSION_STATUS',
        payload: { status: 'completed', session: finishedSession }
      });
      continue;
    }

    // Normal Game Loop (only runs if activeSession exists)
    if (now >= st.phaseEndsAt) {
      if (st.currentPhase === 'reading') {
        if (st.turnsToNextChoice > 0) {
          // Narrative turn: skip voting, go straight to next block
          st.turnsToNextChoice--;
          st.phaseEndsAt = now + NARRATIVE_TURN_MS;
          st.decisionEndsAt = computeDecisionEndsAt(st);
          // Progress bar logic: Do NOT update initialTimeToDecision during narrative turns.
          // This ensures the progress bar counts down smoothly from the start of the reading sequence
          // until the decision phase begins.

          logger.debug(`Narrative turn. Turns remaining: ${st.turnsToNextChoice}, Next phase ends at: ${formatMST(st.phaseEndsAt, "h:mm:ss a")} MST, Time to decision: ${Math.round((st.decisionEndsAt - now) / 1000)}s`, "gameloop");

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
              logger.info(`Advanced story to block ${st.currentBlock.id}`, "gameloop");
            } catch (err) {
              logger.error("Failed to advance narrative", "gameloop", err instanceof Error ? err : new Error(String(err)));
              // Already logged above, removing duplicate
            }
          }
        } else {
        // Choice turn: enter voting phase
          st.currentPhase = 'voting';
          st.phaseEndsAt = now + VOTING_PHASE_MS;
          st.decisionEndsAt = computeDecisionEndsAt(st);
          st.initialTimeToDecision = Math.max(0, st.decisionEndsAt - now);
          logger.info(`ENTERING VOTING PHASE. Ends at: ${formatMST(st.phaseEndsAt, "h:mm:ss a")} MST`, "gameloop");
        }
      } else {
        // Voting phase ended: tally votes and generate next block
        st.currentPhase = 'reading';
        st.phaseEndsAt = now + POST_VOTE_READING_MS;
        st.turnsToNextChoice = getRandomTurns();
        st.decisionEndsAt = computeDecisionEndsAt(st);
        st.initialTimeToDecision = Math.max(0, st.decisionEndsAt - now);
        logger.info(`VOTING ENDED. Starting reading phase with ${st.turnsToNextChoice} turns. Overall ends at: ${formatMST(st.decisionEndsAt, "h:mm:ss a")} MST`, "gameloop");

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
                logger.warn(`Game loop image generation failed for ${channelId}, using fallback`, "gameloop", imageErr);
                // Already logged above
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
            logger.error("Failed to adopt next block", "gameloop", err instanceof Error ? err : new Error(String(err)));
            // Already logged above
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
