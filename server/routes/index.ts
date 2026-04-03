import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "../storage";
import { generateStoryBlock, generateStoryImage } from "../blocks/ai";
import { api } from "@shared/routes";
import { WS_EVENTS, type WsMessage, type Block, type Session } from "@shared/schema";
import { trackUserEmail } from "../analytics";
import { CalendarService } from "../calendar";
import { isAdmin, isDevOnly } from "../middleware/auth";
import { logger } from "../logger";
import { formatInTZ } from "@shared/date";

type ChannelId = string;

// Phase duration constants (milliseconds)
export const NARRATIVE_TURN_MS = 40_000;
export const VOTING_PHASE_MS = 40_000;
export const POST_VOTE_READING_MS = 40_000;

function getRandomTurns() {
  return Math.floor(Math.random() * 3) + 2; // 2, 3, or 4
}

// ---------------------------------------------------------------------------
// Pre-generation — fire-and-forget writes to the pending_blocks table.
//
// The old code stashed Promises in ChannelIdState.nextBlockA/B.  Those die
// with the process.  Now we write the result to the DB so any instance
// (or a restarted instance) can consume it at resolution time.
// ---------------------------------------------------------------------------

function pregenerateOption(channelId: ChannelId, currentBlock: Block, option: "A" | "B"): void {
  const opt = option === "A" ? currentBlock.optionA : currentBlock.optionB;
  const optData = opt as { label?: string; description?: string; } | null;
  const winnerText = `${optData?.label || `Choice ${option}`}: ${optData?.description || `The readers chose option ${option}`}`;
  const previousContext = `Previous event: ${currentBlock.content}\nThe readers chose: ${winnerText}`;

  (async () => {
    try {
      // Guard against duplicate work after a restart that resumes mid-tick.
      const existing = await storage.getPendingBlock(currentBlock.id, option);
      if (existing) return;

      const nextContent = await generateStoryBlock(channelId, previousContext);
      let imageUrl: string;
      try {
        imageUrl = await generateStoryImage(nextContent.content);
      } catch (imageErr) {
        logger.warn(`Image generation failed for ${channelId} option ${option}, using fallback`, "ai", imageErr);
        imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
      }

      await storage.savePendingBlock({
        channelId,
        forBlockId: currentBlock.id,
        choice: option,
        ...nextContent,
        imageUrl,
      });
      logger.debug(`Saved pending block for ${channelId} option ${option} (forBlock ${currentBlock.id})`, "ai");
    } catch (err) {
      logger.error(
        `Failed to pregenerate option ${option} for ${channelId}`,
        "routes",
        err instanceof Error ? err : new Error(String(err))
      );
      // Non-fatal — the game loop has an inline-generation fallback when the
      // pending row is absent at resolution time.
    }
  })();
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function startSessionForChannelId(
  channelId: ChannelId,
  session: Session,
  broadcast: (channelId: ChannelId, message: WsMessage) => void
) {
  logger.info(`Starting session "${session.title}" for channel ${channelId}`, "session");

  // Seed or resume the current block.
  let block = await storage.getCurrentBlock(channelId);
  if (!block) {
    const initialPrompt = "A detective is following a lead in a rainy alleyway.";
    try {
      const nextContent = await generateStoryBlock(channelId, initialPrompt, false);
      let imageUrl: string;
      try {
        imageUrl = await generateStoryImage(nextContent.content);
      } catch {
        imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
      }
      block = await storage.createBlock({ channelId, sessionId: session.id, ...nextContent, imageUrl });
    } catch (err) {
      logger.error("Failed to generate initial block", "session", err instanceof Error ? err : new Error(String(err)));
      block = await storage.createBlock({
        channelId,
        sessionId: session.id,
        title: "System Reboot",
        content: "The story system encountered an anomaly and is attempting to reboot.",
        imageUrl: "/images/img_1771936309521_ieycq2.jpg",
        optionA: { label: "Reboot", description: "Attempt a system reboot." },
        optionB: { label: "Wait", description: "Wait for the anomaly to clear." },
      });
    }
  }

  const LOBBY_DELAY_MS = 3 * 60 * 1000;
  const now = Date.now();
  const phaseEndsAt = new Date(now + LOBBY_DELAY_MS + POST_VOTE_READING_MS);
  const turnsToNextChoice = getRandomTurns();
  const decisionEndsAt = new Date(phaseEndsAt.getTime() + turnsToNextChoice * NARRATIVE_TURN_MS);
  const initialTimeToDecision = Math.max(0, decisionEndsAt.getTime() - now - LOBBY_DELAY_MS);

  // Persist the initial game-loop state so restarts can resume from here.
  await storage.upsertChannelState(channelId, {
    currentPhase: "reading",
    phaseEndsAt,
    decisionEndsAt,
    initialTimeToDecision,
    turnsToNextChoice,
    currentBlockId: block.id,
    activeSessionId: session.id,
  });

  // Kick off background pre-generation for both choices.
  pregenerateOption(channelId, block, "A");
  pregenerateOption(channelId, block, "B");

  await storage.updateSessionStatus(session.id, "active");

  broadcast(channelId, {
    type: "SESSION_STATUS",
    payload: { status: "active", session },
  });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ── ChannelId Endpoints ───────────────────────────────────────────────────

  app.get(api.channels.list.path, async (_req, res) => {
    const channels = await storage.getChannels();
    res.json(channels.map(c => ({
      ...c,
      createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
    })));
  });

  app.get(api.channels.active.path, async (_req, res) => {
    const channels = await storage.getActiveChannels();
    res.json(channels.map(c => ({
      ...c,
      createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
    })));
  });

  // ── Session Endpoints ───────────────────────────────────────────────────

  app.get(api.sessions.next.path, async (req, res) => {
    const channelId = String(req.query.channelId || "");
    if (!channelId) return res.status(400).json({ message: "channelId query parameter is required" });
    const channel = await storage.getChannel(channelId);
    if (!channel) return res.status(404).json({ message: "ChannelId not found" });
    const active = await storage.getActiveSession(channelId);
    if (active) return res.json(active);
    const next = await storage.getNextSession(channelId);
    res.json(next || null);
  });

  app.get("/api/sessions/:id/ics", async (req, res) => {
    const id = parseInt(req.params.id);
    const sessionList = await storage.listSessions();
    const session = sessionList.find(s => s.id === id);
    if (!session) return res.status(404).send("Session not found");
    const icsContent = CalendarService.generateIcs(session);
    res.setHeader("Content-Type", "text/calendar");
    res.setHeader("Content-Disposition", `attachment; filename="session-${id}.ics"`);
    res.send(icsContent);
  });

  app.post(api.sessions.reminder.path, async (req, res) => {
    const { sessionId, email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    // 1. Persist user (lead capture) — even if the rest fails.
    try {
      const existing = await storage.getUserByEmail(email);
      if (!existing) await storage.createUser({ email });
    } catch (err) {
      logger.error("Failed to persist user", "storage", err instanceof Error ? err : new Error(String(err)));
    }

    // 2. Analytics / CRM.
    await trackUserEmail(email, "session_reminder");

    // 3. Calendar invite if a session was specified.
    let session: Session | undefined;
    if (sessionId) {
      const sessionList = await storage.listSessions();
      session = sessionList.find(s => s.id === sessionId);
    }

    if (session) {
      try {
        await Promise.allSettled([
          CalendarService.addToGoogle(email, session),
          CalendarService.sendCalendarInviteViaEmail(email, session),
        ]);
      } catch (err) {
        logger.error("Failed to schedule reminders", "calendar", err instanceof Error ? err : new Error(String(err)));
      }
      res.json({ success: true, message: "You're on the list. Check your email for the notification." });
    } else {
      res.json({ success: true, message: "We'll notify you when the next session is scheduled." });
    }
  });

  app.post("/api/notifications/subscribe", async (req, res) => {
    const { email, subscription } = req.body;
    logger.info(`New subscription: ${email}`, "notifications", { subscription });
    if (email) {
      try {
        const user = await storage.getUserByEmail(email);
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

  // ── Admin Endpoints ──────────────────────────────────────────────────────

  app.get(api.admin.sessions.list.path, isAdmin, async (req, res) => {
    const sessions = await storage.listSessions();
    res.json(sessions);
  });

  app.post(api.admin.sessions.create.path, isAdmin, async (req, res) => {
    const { channelId, title, description, scheduledStart, scheduledEnd, timezone } = req.body;
    const session = await storage.createSession({
      channelId,
      title,
      description,
      scheduledStart: new Date(scheduledStart),
      scheduledEnd: new Date(scheduledEnd),
      timezone: timezone || 'UTC',
    });
    res.status(201).json(session);
  });

  app.patch(api.admin.sessions.cancel.path, isAdmin, async (req, res) => {
    const id = parseInt(String(req.params.id));
    const session = await storage.cancelSession(id);
    res.json(session);
  });

  // ── Debug Endpoints (dev only) ───────────────────────────────────────────
  //
  // These used to mutate the in-memory `state` object directly.  They now
  // write to the DB so the next game-loop tick picks up the change regardless
  // of which instance serves the request.

  app.post("/api/debug/sessions/start", isDevOnly, isAdmin, async (req, res) => {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ success: false, message: "channelId is required" });
    const channel = await storage.getChannel(channelId);
    if (!channel) return res.status(404).json({ success: false, message: "ChannelId not found" });

    const dbState = await storage.getChannelState(channelId);
    if (dbState?.activeSessionId) {
      return res.status(400).json({ success: false, message: "A session is already active for this channel" });
    }

    let session = await storage.getNextSession(channelId);
    if (!session) {
      session = await storage.createSession({
        channelId,
        title: `Debug Session ${new Date().toISOString()}`,
        description: "Manually triggered debug session",
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 3_600_000),
      });
    }

    // Use a local broadcast closure — the WS server isn't in scope yet at
    // this point in the file, so we pass it in via the outer `broadcast`
    // reference that is defined after the WS setup block below.
    // (In practice this endpoint is only called after the server is fully
    //  initialised, so `broadcast` is always defined.)
    await startSessionForChannelId(channelId, session, broadcast);
    res.json({ success: true, message: "Session started", session });
  });

  app.post("/api/debug/sessions/skip", isDevOnly, isAdmin, async (req, res) => {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ success: false, message: "channelId is required" });
    const dbState = await storage.getChannelState(channelId);
    if (!dbState?.activeSessionId) {
      return res.status(404).json({ success: false, message: "No active session" });
    }
    logger.debug(`Skipping phase for channel ${channelId}`, "debug");
    await storage.upsertChannelState(channelId, { phaseEndsAt: new Date() });
    res.json({ success: true, message: "Phase skip triggered" });
  });

  app.post("/api/debug/sessions/tally", isDevOnly, isAdmin, async (req, res) => {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ success: false, message: "channelId is required" });
    const dbState = await storage.getChannelState(channelId);
    if (!dbState?.activeSessionId) {
      return res.status(404).json({ success: false, message: "No active session" });
    }
    if (dbState.currentPhase !== "voting") {
      return res.status(400).json({ success: false, message: "Not in voting phase" });
    }
    logger.debug(`Forcing tally for channel ${channelId}`, "debug");
    await storage.upsertChannelState(channelId, { phaseEndsAt: new Date() });
    res.json({ success: true, message: "Tally forced" });
  });

  app.post("/api/debug/sessions/narrative", isDevOnly, isAdmin, async (req, res) => {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ success: false, message: "channelId is required" });
    const dbState = await storage.getChannelState(channelId);
    if (!dbState?.activeSessionId) {
      return res.status(404).json({ success: false, message: "No active session" });
    }
    if (dbState.turnsToNextChoice <= 0) {
      return res.status(400).json({ success: false, message: "Already at decision phase" });
    }
    logger.debug(`Forcing narrative turn for channel ${channelId}`, "debug");
    await storage.upsertChannelState(channelId, { phaseEndsAt: new Date() });
    res.json({ success: true, message: "Narrative turn forced" });
  });

  app.post("/api/debug/sessions/resolve", isDevOnly, isAdmin, async (req, res) => {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ success: false, message: "channelId is required" });
    const dbState = await storage.getChannelState(channelId);
    if (!dbState?.activeSessionId) {
      return res.status(404).json({ success: false, message: "No active session for this channel" });
    }
    logger.debug(`Forcing resolution for channel ${channelId}`, "debug");
    await storage.updateSessionScheduledEnd(dbState.activeSessionId, new Date());
    await storage.upsertChannelState(channelId, { phaseEndsAt: new Date() });
    res.json({ success: true, message: "Resolution triggered" });
  });

  // ── REST API ─────────────────────────────────────────────────────────────

  app.get(api.blocks.current.path, async (req, res) => {
    const channelId = String(req.query.channelId || "");
    if (!channelId) return res.status(400).json({ message: "channelId query parameter is required" });

    const dbState = await storage.getChannelState(channelId);
    if (!dbState?.activeSessionId || !dbState.currentBlockId) {
      return res.status(404).json({ message: "No active session" });
    }

    const block = await storage.getBlockById(dbState.currentBlockId);
    if (!block) return res.status(404).json({ message: "No active session" });

    const now = Date.now();
    res.json({
      ...block,
      createdAt: block.createdAt?.toISOString() ?? new Date().toISOString(),
      phase: dbState.currentPhase,
      timeRemaining: Math.max(0, dbState.phaseEndsAt.getTime() - now),
      timeToNextDecision: Math.max(0, dbState.decisionEndsAt.getTime() - now),
      initialTimeToNextDecision: dbState.initialTimeToDecision,
      turnsToNextChoice: dbState.turnsToNextChoice,
    });
  });

  app.get(api.chat.history.path, async (req, res) => {
    const channelId = String(req.query.channelId || "");
    if (!channelId) return res.status(400).json({ message: "channelId query parameter is required" });

    const dbState = await storage.getChannelState(channelId);
    let sessionId = dbState?.activeSessionId ?? undefined;
    if (!sessionId) {
      const nextSession = await storage.getNextSession(channelId);
      sessionId = nextSession?.id;
    }

    const messages = await storage.getRecentChat(channelId, sessionId, 50);
    res.json(messages.reverse().map(m => ({
      ...m,
      createdAt: m.createdAt?.toISOString() ?? new Date().toISOString(),
    })));
  });

  // ── WebSocket Setup ──────────────────────────────────────────────────────

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  // Map of WS connection → channel.  This is intentionally process-local:
  // each instance only delivers to connections it owns.  For multi-instance
  // deployments, add a Redis pub/sub subscriber here that calls broadcast()
  // whenever a game-loop message is published on `channel:<channelId>`.
  const clientChannelIds = new Map<WebSocket, ChannelId>();

  function broadcast(channelId: ChannelId, message: WsMessage) {
    const payload = JSON.stringify(message);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && clientChannelIds.get(client) === channelId) {
        client.send(payload);
      }
    });
  }

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const channelId = url.searchParams.get("channelId");
    const debug = url.searchParams.get("debug") === "true";
    const token = url.searchParams.get("token");

    if (!channelId) {
      logger.warn("WebSocket connection without channelId", "ws");
      ws.close(4000, "channelId required");
      return;
    }

    if (debug) {
      if (
        token !== process.env.ADMIN_TOKEN &&
        (process.env.NODE_ENV === "production" || token !== "dev-token")
      ) {
        logger.warn(`Unauthorized debug access attempt for channel ${channelId}`, "ws");
        ws.close(4001, "Unauthorized focus");
        return;
      }
    }

    clientChannelIds.set(ws, channelId);

    // Send initial state from DB — no in-memory dependency.
    (async () => {
      const dbState = await storage.getChannelState(channelId);
      const block = dbState?.currentBlockId
        ? await storage.getBlockById(dbState.currentBlockId)
        : null;

      if (dbState?.activeSessionId && block) {
        const connectNow = Date.now();
        ws.send(JSON.stringify({
          type: "SYNC_STATE",
          payload: {
            ...block,
            createdAt: block.createdAt?.toISOString() ?? new Date().toISOString(),
            phase: dbState.currentPhase,
            timeRemaining: Math.max(0, dbState.phaseEndsAt.getTime() - connectNow),
            timeToNextDecision: Math.max(0, dbState.decisionEndsAt.getTime() - connectNow),
            initialTimeToNextDecision: dbState.initialTimeToDecision,
            turnsToNextChoice: dbState.turnsToNextChoice,
          },
        }));
      } else {
        const next = await storage.getNextSession(channelId);
        ws.send(JSON.stringify({
          type: "SESSION_STATUS",
          payload: { status: "scheduled", session: next || null },
        }));
      }
    })();

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage;
        const currentChannelId = clientChannelIds.get(ws) || ("mystery" as ChannelId);

        if (message.type === "SUBMIT_CHAT") {
          const { username, text } = message.payload as { username: string; text: string; };
          if (username && text) {
            const dbState = await storage.getChannelState(currentChannelId);
            let sessionId = dbState?.activeSessionId ?? undefined;
            if (!sessionId) {
              const nextSession = await storage.getNextSession(currentChannelId);
              sessionId = nextSession?.id;
            }
            const newMsg = await storage.createChat({ channelId: currentChannelId, username, text, sessionId });
            broadcast(currentChannelId, {
              type: "CHAT_MESSAGE",
              payload: {
                ...newMsg,
                createdAt: newMsg.createdAt?.toISOString() ?? new Date().toISOString(),
              },
            });
          }

        } else if (message.type === "SUBMIT_REACTION") {
          const { blockId, emoji, userId, paragraphIndex } = message.payload as {
            blockId: number; emoji: string; userId: string; paragraphIndex: number;
          };
          if (blockId && emoji) {
            const dbState = await storage.getChannelState(currentChannelId);
            const reaction = await storage.addReaction({
              channelId: currentChannelId,
              sessionId: dbState?.activeSessionId || 0,
              blockId,
              userId: userId || "anon",
              emoji,
              paragraphIndex: paragraphIndex || 0,
            });
            broadcast(currentChannelId, { type: "REACTION_RECEIVED", payload: reaction });
          }

        } else if (message.type === "SUBMIT_VOTE") {
          const { choice, userId } = message.payload as { choice: string; userId: string; };
          if (choice === "A" || choice === "B") {
            // Read phase and current block from DB — authoritative regardless of instance.
            const dbState = await storage.getChannelState(currentChannelId);
            const currentBlock = dbState?.currentBlockId
              ? await storage.getBlockById(dbState.currentBlockId)
              : null;

            if (dbState?.currentPhase === "voting" && currentBlock) {
              await storage.createVote({
                channelId: currentChannelId,
                sessionId: dbState.activeSessionId || 0,
                blockId: currentBlock.id,
                userId: userId || `anon-${Math.random()}`,
                choice,
              });
              const votes = await storage.getVotesForBlock(currentBlock.id);
              const countA = votes.filter(v => v.choice === "A").length;
              const countB = votes.filter(v => v.choice === "B").length;
              broadcast(currentChannelId, { type: "VOTE_UPDATE", payload: { A: countA, B: countB } });
            }
          }
        }
      } catch (err) {
        logger.error("WS message error", "ws", err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.on("close", () => {
      clientChannelIds.delete(ws);
    });
  });

  // ── Game Loop ────────────────────────────────────────────────────────────
  logger.info('Starting game loop (1-second tick)', 'game-loop');
  setInterval(async () => {
    await handleGameLoopTick(Date.now(), broadcast);
  }, 1000);

  return httpServer;
}

// ---------------------------------------------------------------------------
// Game loop tick — fully DB-backed, safe to run on multiple instances.
//
// Each tick:
//   1. Reads channel_states from DB for every channel.
//   2. If a phase transition is due, acquires the advisory lock (atomic UPDATE).
//      Only one instance will win the lock; others skip and retry next second.
//   3. Performs the transition (AI generation, block creation, state update).
//   4. Releases the lock in a `finally` block.
//   5. During the heartbeat (no transition due), broadcasts current state to
//      all locally connected WS clients for timer synchronisation.
// ---------------------------------------------------------------------------

export async function handleGameLoopTick(
  now: number,
  broadcast: (channelId: ChannelId, message: WsMessage) => void
) {
  const activeChannelIds = await storage.getActiveChannels();
  for (const channel of activeChannelIds) {
    const channelId = channel.channelId;
    try {
      const dbState = await storage.getChannelState(channelId);

      if (!dbState?.activeSessionId) {
        const next = await storage.getNextSession(channelId);
        if (next) {
          const timeUntilStart = next.scheduledStart.getTime() - now;
          logger.debug(`[GameLoop] Channel ${channelId}: next session "${next.title}" starts in ${Math.round(timeUntilStart/1000)}s`, 'game-loop');
          
          if (now >= next.scheduledStart.getTime() - 3 * 60 * 1000) {
            logger.info(`[GameLoop] Channel ${channelId}: Session "${next.title}" entering start window (${Math.round(timeUntilStart/1000)}s until start)`, 'game-loop');
            const locked = await storage.tryAcquireGameLock(channelId, 30_000);
            if (!locked) {
              logger.debug(`[GameLoop] Channel ${channelId}: Could not acquire lock`, 'game-loop');
              continue;
            }
            try {
              await startSessionForChannelId(channelId, next, broadcast);
            } finally {
              await storage.releaseGameLock(channelId);
            }
          }
        }
        continue;
      }

      const activeSession = await storage.getSessionById(dbState.activeSessionId);
      if (!activeSession) {
        // Stale FK — clear it so we don't loop forever on a missing session.
        await storage.upsertChannelState(channelId, { activeSessionId: null, currentBlockId: null });
        continue;
      }

      // ── Session overrun: enter resolution phase ───────────────────────
      if (dbState.currentPhase !== "resolution" && now >= activeSession.scheduledEnd.getTime()) {
        const locked = await storage.tryAcquireGameLock(channelId, 90_000);
        if (!locked) continue;
        try {
          logger.info(
            `Session "${activeSession.title}" reaching scheduled end. Entering resolution.`,
            "session"
          );

          let resolutionBlockId = dbState.currentBlockId;
          const currentBlock = dbState.currentBlockId
            ? await storage.getBlockById(dbState.currentBlockId)
            : null;

          if (currentBlock) {
            try {
              const previousContext = `Previous event: ${currentBlock.content}`;
              const nextContent = await generateStoryBlock(channelId, previousContext, true);
              let imageUrl: string;
              try {
                imageUrl = await generateStoryImage(nextContent.content);
              } catch {
                imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
              }
              const resBlock = await storage.createBlock({
                channelId,
                sessionId: activeSession.id,
                ...nextContent,
                imageUrl,
              });
              resolutionBlockId = resBlock.id;
              logger.info(`Resolution block generated: ${resBlock.id}`, "gameloop");
            } catch (err) {
              logger.error(
                "Failed to generate resolution block",
                "gameloop",
                err instanceof Error ? err : new Error(String(err))
              );
            }
          }

          const resPhaseEndsAt = new Date(now + 60_000);
          await storage.upsertChannelState(channelId, {
            currentPhase: "resolution",
            phaseEndsAt: resPhaseEndsAt,
            decisionEndsAt: resPhaseEndsAt,
            turnsToNextChoice: 0,
            initialTimeToDecision: 0,
            currentBlockId: resolutionBlockId,
          });

          if (resolutionBlockId) {
            const resBlock = await storage.getBlockById(resolutionBlockId);
            if (resBlock) {
              broadcast(channelId, {
                type: "SYNC_STATE",
                payload: {
                  ...resBlock,
                  createdAt: resBlock.createdAt?.toISOString() ?? new Date().toISOString(),
                  phase: "resolution",
                  timeRemaining: 60_000,
                  timeToNextDecision: 0,
                  initialTimeToNextDecision: 0,
                  turnsToNextChoice: 0,
                },
              });
            }
          }
        } finally {
          await storage.releaseGameLock(channelId);
        }
        continue;
      }

      // ── Resolution ended: mark session complete ───────────────────────
      if (dbState.currentPhase === "resolution" && now >= dbState.phaseEndsAt.getTime()) {
        const locked = await storage.tryAcquireGameLock(channelId, 10_000);
        if (!locked) continue;
        try {
          logger.info(
            `Ending session "${activeSession.title}" for channel ${channelId} after resolution.`,
            "session"
          );
          await storage.updateSessionStatus(activeSession.id, "completed");
          await storage.upsertChannelState(channelId, {
            activeSessionId: null,
            currentBlockId: null,
            currentPhase: "reading",
          });
          broadcast(channelId, {
            type: "SESSION_STATUS",
            payload: { status: "completed", session: activeSession },
          });
        } finally {
          await storage.releaseGameLock(channelId);
        }
        continue;
      }

      // ── Normal game loop ─────────────────────────────────────────────
      if (now >= dbState.phaseEndsAt.getTime()) {
        const locked = await storage.tryAcquireGameLock(channelId, 90_000);
        if (!locked) continue;

        try {
          const currentBlock = dbState.currentBlockId
            ? await storage.getBlockById(dbState.currentBlockId)
            : null;

          if (dbState.currentPhase === "reading") {

            if (dbState.turnsToNextChoice > 0) {
              // ── Narrative turn: advance story without a vote ──────────
              let nextData: {
                title: string;
                content: string;
                imageUrl: string;
                optionA?: unknown;
                optionB?: unknown;
              };

              // Prefer the pre-generated pending block for choice A (used as
              // the default narrative continuation).
              const pending = currentBlock
                ? await storage.getPendingBlock(currentBlock.id, "A")
                : null;

              if (pending) {
                nextData = {
                  title: pending.title,
                  content: pending.content,
                  imageUrl: pending.imageUrl,
                  optionA: pending.optionA,
                  optionB: pending.optionB,
                };
                await storage.deletePendingBlocksForBlock(currentBlock!.id);
              } else {
                // Fallback: generate inline if pre-generation hasn't finished.
                const opt = currentBlock?.optionA;
                const optData = opt as { label?: string; description?: string; } | null;
                const winnerText = `${optData?.label || "Choice A"}: ${optData?.description || "The story continues..."}`;
                const previousContext = `${currentBlock?.title ?? ""}\n${currentBlock?.content ?? ""}${winnerText}`;
                const nextContent = await generateStoryBlock(channelId, previousContext);
                let imageUrl: string;
                try {
                  imageUrl = await generateStoryImage(nextContent.content);
                } catch {
                  imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
                }
                nextData = { ...nextContent, imageUrl };
              }

              const newBlock = await storage.createBlock({
                channelId,
                sessionId: activeSession.id,
                ...nextData,
              } as any);

              const newTurns = dbState.turnsToNextChoice - 1;
              const newPhaseEndsAt = new Date(now + NARRATIVE_TURN_MS);
              const newDecisionEndsAt = new Date(newPhaseEndsAt.getTime() + newTurns * NARRATIVE_TURN_MS);

              await storage.upsertChannelState(channelId, {
                currentBlockId: newBlock.id,
                turnsToNextChoice: newTurns,
                phaseEndsAt: newPhaseEndsAt,
                decisionEndsAt: newDecisionEndsAt,
              });

              pregenerateOption(channelId, newBlock, "A");
              pregenerateOption(channelId, newBlock, "B");

              logger.info(`Advanced story to block ${newBlock.id}`, "gameloop");
              logger.debug(
                `Narrative turn. Turns remaining: ${newTurns}, ` +
                `Next phase ends at: ${formatInTZ(newPhaseEndsAt.getTime(), 'UTC', "h:mm:ss a")} UTC, ` +
                `Time to decision: ${Math.round((newDecisionEndsAt.getTime() - now) / 1000)}s`,
                "gameloop"
              );

              broadcast(channelId, {
                type: "SYNC_STATE",
                payload: {
                  ...newBlock,
                  createdAt: newBlock.createdAt?.toISOString() ?? new Date().toISOString(),
                  phase: "reading",
                  timeRemaining: NARRATIVE_TURN_MS,
                  timeToNextDecision: Math.max(0, newDecisionEndsAt.getTime() - now),
                  initialTimeToNextDecision: dbState.initialTimeToDecision,
                  turnsToNextChoice: newTurns,
                },
              });

            } else {
              // ── Enter voting phase ────────────────────────────────────
              const newPhaseEndsAt = new Date(now + VOTING_PHASE_MS);
              await storage.upsertChannelState(channelId, {
                currentPhase: "voting",
                phaseEndsAt: newPhaseEndsAt,
                decisionEndsAt: newPhaseEndsAt,
                initialTimeToDecision: VOTING_PHASE_MS,
              });

              logger.info(
                `ENTERING VOTING PHASE. Ends at: ${formatInTZ(newPhaseEndsAt.getTime(), 'UTC', "h:mm:ss a")} UTC`,
                "gameloop"
              );

              if (currentBlock) {
                broadcast(channelId, {
                  type: "SYNC_STATE",
                  payload: {
                    ...currentBlock,
                    createdAt: currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
                    phase: "voting",
                    timeRemaining: VOTING_PHASE_MS,
                    timeToNextDecision: VOTING_PHASE_MS,
                    initialTimeToNextDecision: VOTING_PHASE_MS,
                    turnsToNextChoice: 0,
                  },
                });
              }
            }

          } else if (dbState.currentPhase === "voting") {
            // ── Voting phase ended: tally and advance ─────────────────
            const votes = currentBlock
              ? await storage.getVotesForBlock(currentBlock.id)
              : [];
            const countA = votes.filter(v => v.choice === "A").length;
            const countB = votes.filter(v => v.choice === "B").length;
            const winner: "A" | "B" = countA >= countB ? "A" : "B";

            let nextData: {
              title: string;
              content: string;
              imageUrl: string;
              optionA?: unknown;
              optionB?: unknown;
            };

            try {
              const pending = currentBlock
                ? await storage.getPendingBlock(currentBlock.id, winner)
                : null;

              if (pending) {
                nextData = {
                  title: pending.title,
                  content: pending.content,
                  imageUrl: pending.imageUrl,
                  optionA: pending.optionA,
                  optionB: pending.optionB,
                };
                await storage.deletePendingBlocksForBlock(currentBlock!.id);
              } else {
                // Fallback: winner's branch wasn't pre-generated in time.
                const opt = winner === "A" ? currentBlock?.optionA : currentBlock?.optionB;
                const optData = opt as { label?: string; description?: string; } | null;
                const winnerText = `${optData?.label || `Choice ${winner}`}: ${optData?.description || `The readers chose option ${winner}`}`;
                const previousContext = `Previous event: ${currentBlock?.content ?? ""}\nThe readers chose: ${winnerText}`;
                const nextContent = await generateStoryBlock(channelId, previousContext);
                let imageUrl: string;
                try {
                  imageUrl = await generateStoryImage(nextContent.content);
                } catch {
                  logger.warn(
                    `Game loop image generation failed for ${channelId}, using fallback`,
                    "gameloop"
                  );
                  imageUrl = await storage.getRandomImage(channelId) || "/images/img_1771936309521_ieycq2.jpg";
                }
                nextData = { ...nextContent, imageUrl };
              }
            } catch (err) {
              logger.error(
                "Failed to adopt next block",
                "gameloop",
                err instanceof Error ? err : new Error(String(err))
              );
              nextData = {
                title: "Temporal Distortion",
                content: "A temporal distortion disrupts the timeline. We must re-establish connection.",
                imageUrl: "/images/img_1771936309521_ieycq2.jpg",
                optionA: { label: "Reconnect", description: "Attempt to reconnect to the timeline." },
                optionB: { label: "Wait", description: "Wait for the distortion to pass." },
              };
            }

            const newBlock = await storage.createBlock({
              channelId,
              sessionId: activeSession.id,
              ...nextData,
            } as any);

            const newTurns = getRandomTurns();
            const newPhaseEndsAt = new Date(now + POST_VOTE_READING_MS);
            const newDecisionEndsAt = new Date(newPhaseEndsAt.getTime() + newTurns * NARRATIVE_TURN_MS);

            await storage.upsertChannelState(channelId, {
              currentPhase: "reading",
              currentBlockId: newBlock.id,
              turnsToNextChoice: newTurns,
              phaseEndsAt: newPhaseEndsAt,
              decisionEndsAt: newDecisionEndsAt,
              initialTimeToDecision: Math.max(0, newDecisionEndsAt.getTime() - now),
            });

            pregenerateOption(channelId, newBlock, "A");
            pregenerateOption(channelId, newBlock, "B");

            logger.info(
              `VOTING ENDED. Starting reading phase with ${newTurns} turns. ` +
              `Overall ends at: ${formatInTZ(newDecisionEndsAt.getTime(), 'UTC', "h:mm:ss a")} UTC`,
              "gameloop"
            );

            broadcast(channelId, {
              type: "SYNC_STATE",
              payload: {
                ...newBlock,
                createdAt: newBlock.createdAt?.toISOString() ?? new Date().toISOString(),
                phase: "reading",
                timeRemaining: POST_VOTE_READING_MS,
                timeToNextDecision: Math.max(0, newDecisionEndsAt.getTime() - now),
                initialTimeToNextDecision: Math.max(0, newDecisionEndsAt.getTime() - now),
                turnsToNextChoice: newTurns,
              },
            });
          }

        } catch (err) {
          logger.error(
            `Game loop transition error for ${channelId}`,
            "gameloop",
            err instanceof Error ? err : new Error(String(err))
          );
        } finally {
          await storage.releaseGameLock(channelId);
        }

      } else {
        // ── Heartbeat: keep client timers in sync ─────────────────────
        // The DB read cost here is one indexed PK lookup per channel per
        // second — trivial for Postgres.  If this ever becomes a bottleneck
        // in a high-channel-count deployment, add a local LRU cache with a
        // 500 ms TTL and fall through to the DB only on a miss.
        if (dbState.currentBlockId) {
          const currentBlock = await storage.getBlockById(dbState.currentBlockId);
          if (currentBlock) {
            broadcast(channelId, {
              type: "SYNC_STATE",
              payload: {
                ...currentBlock,
                createdAt: currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
                phase: dbState.currentPhase,
                timeRemaining: Math.max(0, dbState.phaseEndsAt.getTime() - now),
                timeToNextDecision: Math.max(0, dbState.decisionEndsAt.getTime() - now),
                initialTimeToNextDecision: dbState.initialTimeToDecision,
                turnsToNextChoice: dbState.turnsToNextChoice,
              },
            });
          }
        }
      }

    } catch (err) {
      logger.error(
        `Unhandled error in game loop for channel ${channelId}`,
        "gameloop",
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }
}