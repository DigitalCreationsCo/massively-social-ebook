import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "../storage";
import { api } from "@shared/routes";
import {
  type WsMessage,
  type Session,
  sessions,
  blocks,
  chat,
} from "@shared/schema";
import { trackUserEmail } from "../analytics";
import { CalendarService } from "../calendar";
import { isAdmin, isDevOnly } from "../middleware/auth";
import { logger } from "../logger";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "server/db";
import {
  type ChannelId,
  type CachedBlock,
  NARRATIVE_TURN_MS,
  VOTING_PHASE_MS,
  POST_VOTE_READING_MS,
  LOBBY_DELAY_MS,
  START_BEFORE_MS,
  AFTERPARTY_MS,
  PHASE_INITIAL_MS,
  computeDecisionEndsAt,
  clearChannelCache,
  stateCache,
  blockCache,
  startSessionForChannelId,
  handleChannelTick,
} from "../game-loop/channel-tick";
import { RealtimeEngine, type ActivationResult, type TickResult } from "@portalshq/runtime-core";

// Re-export for tests
export { NARRATIVE_TURN_MS, VOTING_PHASE_MS, POST_VOTE_READING_MS, LOBBY_DELAY_MS, START_BEFORE_MS, AFTERPARTY_MS, computeDecisionEndsAt, clearChannelCache } from "../game-loop/channel-tick";

/**
 * Validates that the WebSocket is registered to a channel.
 * Logs a warning and closes the connection if not registered.
 *
 * Previously the caller fell back to a "mystery" sentinel channelId
 * when the WS was unregistered, which caused cascading DB queries
 * that wasted pool connections and masked the real bug.
 *
 * @returns The channelId, or null if the WS is not registered.
 */
export function getChannelIdForWs(
  ws: WebSocket,
  clientMap: Map<WebSocket, ChannelId>,
): ChannelId | null {
  const channelId = clientMap.get(ws);
  if (!channelId) {
    logger.warn("WebSocket message from unregistered client", "ws");
    ws.close(4000, "Not registered");
    return null;
  }
  return channelId;
}

// ---------------------------------------------------------------------------
// Session lifecycle and pre-generation are now in server/game-loop/channel-tick.ts
// (startSessionForChannelId, pregenerateOption, handleChannelTick, etc.)
// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // ── ChannelId Endpoints ───────────────────────────────────────────────────

  app.get(api.channels.list.path, async (_req, res) => {
    const channels = await storage.getChannels();
    res.json(
      channels.map((c) => ({
        ...c,
        createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
      })),
    );
  });

  app.get(api.channels.active.path, async (_req, res) => {
    const channels = await storage.getActiveChannels();
    res.json(
      channels.map((c) => ({
        ...c,
        createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
      })),
    );
  });

  // ── Session Endpoints ───────────────────────────────────────────────────

  app.get(api.sessions.next.path, async (req, res) => {
    const channelId = String(req.query.channelId || "");
    if (!channelId)
      return res
        .status(400)
        .json({ message: "channelId query parameter is required" });
    const channel = await storage.getChannel(channelId);
    if (!channel)
      return res.status(404).json({ message: "ChannelId not found" });
    const now = Date.now();
    const active = await storage.getActiveSession(channelId);
    if (active && active.scheduledEnd.getTime() > now) {
      return res.json({
        session: active,
        channel: {
          ...channel,
          createdAt:
            channel.createdAt?.toISOString() ?? new Date().toISOString(),
        },
      });
    }
    const next = await storage.getNextSession(channelId);
    res.json({
      session: next || null,
      channel: {
        ...channel,
        createdAt: channel.createdAt?.toISOString() ?? new Date().toISOString(),
      },
    });
  });

  // GET /api/sessions/history
  // Supports fetching a specific completed session, or defaults to the most recent completed.
  app.get("/api/sessions/history", async (req, res) => {
    const t0 = Date.now();
    const { channelId, sessionId } = req.query;

    const t1 = Date.now();

    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }

    try {
      const t2 = Date.now();
      let queryConditions = and(
        eq(sessions.channelId, String(channelId)),
        eq(sessions.status, "completed"),
      );

      // If a specific session is requested, append it to the conditions
      if (sessionId) {
        queryConditions = and(
          queryConditions,
          eq(sessions.id, Number(sessionId)),
        );
      }

      const tBeforeDb = Date.now();

      const [sessionResult] = await db
        .select()
        .from(sessions)
        .where(queryConditions)
        .orderBy(desc(sessions.scheduledEnd)) // Always get the most recent if no ID provided
        .limit(1);

      const t3 = Date.now();

      if (!sessionResult) {
        return res.status(404).json({ error: "No completed sessions found." });
      }

      res.json(sessionResult);

      const t4 = Date.now();

      // Log timing breakdown to isolate where the 6.7s goes
      logger.info("TIMING /api/sessions/history", "routes", {
        parse: t2 - t1,            // query param parsing
        queryBuild: tBeforeDb - t2, // query condition building
        db: t3 - tBeforeDb,        // actual DB query time
        serialize_send: t4 - t3,    // response serialization + send
        total: t4 - t0,            // total handler wall time
        channelId: String(channelId),
        sessionId: sessionId ? Number(sessionId) : null,
      });
    } catch (error) {
      logger.error(
        "Failed to fetch session history",
        "routes",
        error instanceof Error ? error : new Error(String(error)),
      );
      res.status(500).json({ error: "Failed to fetch session history" });
    }
  });

  app.get("/api/sessions/:id/ics", async (req, res) => {
    const id = parseInt(req.params.id);
    const sessionList = await storage.listSessions();
    const session = sessionList.find((s) => s.id === id);
    if (!session) return res.status(404).send("Session not found");
    const icsContent = CalendarService.generateIcs(session);
    res.setHeader("Content-Type", "text/calendar");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="session-${id}.ics"`,
    );
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
      logger.error(
        "Failed to persist user",
        "storage",
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    // 2. Analytics / CRM.
    await trackUserEmail(email, "session_reminder");

    // 3. Calendar invite if a session was specified.
    let session: Session | undefined;
    if (sessionId) {
      const sessionList = await storage.listSessions();
      session = sessionList.find((s) => s.id === sessionId);
    }

    if (session) {
      try {
        await Promise.allSettled([
          CalendarService.addToGoogle(email, session),
          CalendarService.sendCalendarInviteViaEmail(email, session),
        ]);
      } catch (err) {
        logger.error(
          "Failed to schedule reminders",
          "calendar",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      res.json({
        success: true,
        message: "You're on the list. Check your email for the notification.",
      });
    } else {
      res.json({
        success: true,
        message: "We'll notify you when the next session is scheduled.",
      });
    }
  });

  app.post("/api/notifications/subscribe", async (req, res) => {
    const { email, subscription } = req.body;
    logger.info(`New subscription: ${email}`, "notifications", {
      subscription,
    });
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
        logger.error(
          "Failed to persist subscription user",
          "storage",
          err instanceof Error ? err : new Error(String(err)),
        );
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
    const {
      channelId,
      title,
      description,
      scheduledStart,
      scheduledEnd,
      timezone,
    } = req.body;
    const session = await storage.createSession({
      channelId,
      title,
      description,
      scheduledStart: new Date(scheduledStart),
      scheduledEnd: new Date(scheduledEnd),
      timezone: timezone || "UTC",
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

  app.post(
    "/api/debug/sessions/start",
    isDevOnly,
    isAdmin,
    async (req, res) => {
      const { channelId } = req.body;
      if (!channelId)
        return res
          .status(400)
          .json({ success: false, message: "channelId is required" });
      const channel = await storage.getChannel(channelId);
      if (!channel)
        return res
          .status(404)
          .json({ success: false, message: "ChannelId not found" });

      const dbState = await storage.getChannelState(channelId);
      if (dbState?.activeSessionId) {
        return res.status(400).json({
          success: false,
          message: "A session is already active for this channel",
        });
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
    },
  );

  app.post("/api/debug/sessions/skip", isDevOnly, isAdmin, async (req, res) => {
    const { channelId } = req.body;
    if (!channelId)
      return res
        .status(400)
        .json({ success: false, message: "channelId is required" });
    const dbState = await storage.getChannelState(channelId);
    if (!dbState?.activeSessionId) {
      return res
        .status(404)
        .json({ success: false, message: "No active session" });
    }
    logger.debug(`Skipping phase for channel ${channelId}`, "debug");
    await storage.upsertChannelState(channelId, { phaseEndsAt: new Date() });
    res.json({ success: true, message: "Phase skip triggered" });
  });

  app.post(
    "/api/debug/sessions/tally",
    isDevOnly,
    isAdmin,
    async (req, res) => {
      const { channelId } = req.body;
      if (!channelId)
        return res
          .status(400)
          .json({ success: false, message: "channelId is required" });
      const dbState = await storage.getChannelState(channelId);
      if (!dbState?.activeSessionId) {
        return res
          .status(404)
          .json({ success: false, message: "No active session" });
      }
      if (dbState.currentPhase !== "voting") {
        return res
          .status(400)
          .json({ success: false, message: "Not in voting phase" });
      }
      logger.debug(`Forcing tally for channel ${channelId}`, "debug");
      await storage.upsertChannelState(channelId, { phaseEndsAt: new Date() });
      res.json({ success: true, message: "Tally forced" });
    },
  );

  app.post(
    "/api/debug/sessions/narrative",
    isDevOnly,
    isAdmin,
    async (req, res) => {
      const { channelId } = req.body;
      if (!channelId)
        return res
          .status(400)
          .json({ success: false, message: "channelId is required" });
      const dbState = await storage.getChannelState(channelId);
      if (!dbState?.activeSessionId) {
        return res
          .status(404)
          .json({ success: false, message: "No active session" });
      }
      if (dbState.turnsToNextChoice <= 0) {
        return res
          .status(400)
          .json({ success: false, message: "Already at decision phase" });
      }
      logger.debug(`Forcing narrative turn for channel ${channelId}`, "debug");
      await storage.upsertChannelState(channelId, { phaseEndsAt: new Date() });
      res.json({ success: true, message: "Narrative turn forced" });
    },
  );

  app.post(
    "/api/debug/sessions/resolve",
    isDevOnly,
    isAdmin,
    async (req, res) => {
      const { channelId } = req.body;
      if (!channelId)
        return res
          .status(400)
          .json({ success: false, message: "channelId is required" });
      const dbState = await storage.getChannelState(channelId);
      if (!dbState?.activeSessionId) {
        return res.status(404).json({
          success: false,
          message: "No active session for this channel",
        });
      }
      logger.debug(`Forcing resolution for channel ${channelId}`, "debug");
      await storage.updateSessionScheduledEnd(
        dbState.activeSessionId,
        new Date(),
      );
      await storage.upsertChannelState(channelId, { phaseEndsAt: new Date() });
      res.json({ success: true, message: "Resolution triggered" });
    },
  );

  app.get(api.blocks.current.path, async (req, res) => {
    const channelId = String(req.query.channelId || "");
    if (!channelId)
      return res
        .status(400)
        .json({ message: "channelId query parameter is required" });

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
      phaseInitialMs: PHASE_INITIAL_MS[dbState.currentPhase] ?? NARRATIVE_TURN_MS,
    });
  });

  // GET /api/blocks/history
  // Retrieves blocks in chronological order, optionally filtered by notable, with top 10 chats.
  app.get("/api/blocks/history", async (req, res) => {
    const sessionId = Number(req.query.sessionId);
    const notableOnly = req.query.notableOnly === "true";

    if (!sessionId) {
      return res.status(400).json({
        error: "sessionId is required",
      });
    }

    try {
      const blocks = await storage.getReplayBlocks(sessionId, notableOnly);

      res.json(blocks);
    } catch (error) {
      logger.error(
        "Failed to fetch historical blocks",
        "routes",
        error instanceof Error ? error : new Error(String(error)),
      );

      res.status(500).json({
        error: "Failed to fetch historical blocks",
      });
    }
  });

  app.get(api.chat.history.path, async (req, res) => {
    const channelId = String(req.query.channelId || "");
    if (!channelId)
      return res
        .status(400)
        .json({ message: "channelId query parameter is required" });

    const dbState = await storage.getChannelState(channelId);
    let sessionId = dbState?.activeSessionId ?? undefined;
    if (!sessionId) {
      const nextSession = await storage.getNextSession(channelId);
      sessionId = nextSession?.id;
    }

    const messages = await storage.getRecentChat(channelId, sessionId, 50);
    res.json(
      messages.reverse().map((m) => ({
        ...m,
        createdAt: m.createdAt?.toISOString() ?? new Date().toISOString(),
      })),
    );
  });

  // ── WebSocket Setup ──────────────────────────────────────────────────────
  //
  // noServer + manual upgrade routing: attaching via `{ server, path: "/ws" }`
  // makes `ws` call abortHandshake(400) on every other WebSocket path (including
  // Vite HMR at /__vite_hmr), which breaks hot module reload in development.

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(
      request.url || "",
      `http://${request.headers.host}`,
    ).pathname;
    if (pathname !== "/ws") return;

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  // Map of WS connection → channel.  This is intentionally process-local:
  // each instance only delivers to connections it owns.  For multi-instance
  // deployments, add a Redis pub/sub subscriber here that calls broadcast()
  // whenever a game-loop message is published on `channel:<channelId>`.
  const clientChannelIds = new Map<WebSocket, ChannelId>();

  function broadcast(channelId: ChannelId, message: WsMessage) {
    const payload = JSON.stringify(message);
    wss.clients.forEach((client) => {
      if (
        client.readyState === WebSocket.OPEN &&
        clientChannelIds.get(client) === channelId
      ) {
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
        logger.warn(
          `Unauthorized debug access attempt for channel ${channelId}`,
          "ws",
        );
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

      const connectNow = Date.now();
      if (dbState?.activeSessionId) {
        const activeSession = await storage.getSessionById(
          dbState.activeSessionId,
        );
        if (
          activeSession &&
          activeSession.scheduledEnd.getTime() > connectNow
        ) {
          if (block) {
            ws.send(
              JSON.stringify({
                type: "SYNC_STATE",
                  payload: {
                    ...block,
                    createdAt:
                      block.createdAt?.toISOString() ?? new Date().toISOString(),
                    phase: dbState.currentPhase,
                    timeRemaining: Math.max(
                      0,
                      dbState.phaseEndsAt.getTime() - connectNow,
                    ),
                    timeToNextDecision: Math.max(
                      0,
                      dbState.decisionEndsAt.getTime() - connectNow,
                    ),
                    initialTimeToNextDecision: dbState.initialTimeToDecision,
                    turnsToNextChoice: dbState.turnsToNextChoice,
                    phaseInitialMs: PHASE_INITIAL_MS[dbState.currentPhase] ?? NARRATIVE_TURN_MS,
                  },
                }),
              );
            }
            ws.send(
            JSON.stringify({
              type: "SESSION_STATUS",
              payload: { status: activeSession.status, session: activeSession },
            }),
          );
        }
      } else {
        const next = await storage.getNextSession(channelId);
        ws.send(
          JSON.stringify({
            type: "SESSION_STATUS",
            payload: { status: "scheduled", session: next || null },
          }),
        );
      }
    })();

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage;

        const currentChannelId = getChannelIdForWs(ws, clientChannelIds);
        if (!currentChannelId) return;

        if (message.type === "SUBMIT_CHAT") {
          const { username, text, clientId } = message.payload as {
            username: string;
            text: string;
            clientId?: string;
          };
          if (username && text) {
            const dbState = await storage.getChannelState(currentChannelId);
            let sessionId = dbState?.activeSessionId ?? undefined;
            if (!sessionId) {
              const nextSession =
                await storage.getNextSession(currentChannelId);
              sessionId = nextSession?.id;
            }
            const newMsg = await storage.createChat({
              channelId: currentChannelId,
              username,
              text,
              sessionId,
            });
            broadcast(currentChannelId, {
              type: "CHAT_MESSAGE",
              payload: {
                ...newMsg,
                createdAt:
                  newMsg.createdAt?.toISOString() ?? new Date().toISOString(),
                ...(clientId ? { clientId } : {}),
              },
            });
          }
        } else if (message.type === "SUBMIT_REACTION") {
          const { blockId, emoji, userId, paragraphIndex } =
            message.payload as {
              blockId: number;
              emoji: string;
              userId: string;
              paragraphIndex: number;
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
            broadcast(currentChannelId, {
              type: "REACTION_RECEIVED",
              payload: reaction,
            });
          }
        } else if (message.type === "SUBMIT_VOTE") {
          const { choice, userId } = message.payload as {
            choice: string;
            userId: string;
          };
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
              const countA = votes.filter((v) => v.choice === "A").length;
              const countB = votes.filter((v) => v.choice === "B").length;
              broadcast(currentChannelId, {
                type: "VOTE_UPDATE",
                payload: { A: countA, B: countB },
              });
            }
          }
        }
      } catch (err) {
        logger.error(
          "WS message error",
          "ws",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    });

    ws.on("close", () => {
      clientChannelIds.delete(ws);
    });
  });

  // ── Game Loop ────────────────────────────────────────────────────────────
  // Replaces the old global `setInterval(1000)` that polled ALL channels
  // every second with:
  //   1. A RealtimeEngine that runs per-channel timers only while viewers
  //      are connected (presence-triggered).
  //   2. A lightweight 30-second watcher that catches channels whose
  //      sessions are due but have zero viewers (bridging the gap between
  //      the scheduler creating a session record and the engine activating
  //      it when the first viewer arrives).
  // -------------------------------------------------------------------------

  const engine = new RealtimeEngine({
    tickIntervalMs: 1000,
    onActivate: async (cid: ChannelId): Promise<ActivationResult> => {
      // Check if there's an active session already in progress.
      const cachedState = stateCache.get(cid);
      if (cachedState?.activeSessionId) {
        return true; // start ticking immediately
      }

      // Check if there's a scheduled session due or coming soon.
      const next = await storage.getNextSession(cid);
      if (!next) return false; // nothing scheduled at all

      const isDue =
        Date.now() >= next.scheduledStart.getTime() - START_BEFORE_MS;
      if (isDue) {
        // Session is due — start it (lock via the tick's internal mechanism).
        return true;
      }

      // Scheduled for the future — set a recheck timer.
      return {
        scheduleRecheckAt: next.scheduledStart.getTime() - START_BEFORE_MS,
      };
    },
    onTick: async (cid: ChannelId): Promise<TickResult> => {
      const result = await handleChannelTick(
        cid,
        Date.now(),
        broadcast,
        startSessionForChannelId,
      );
      return { continue: result.continue };
    },
    onDeactivate: async (cid: ChannelId) => {
      logger.info(`Channel ${cid}: tick engine stopped`, "game-loop");
    },
    logger,
  });

  // Expose so the debug endpoint can check / control the engine.
  (httpServer as any).__realtimeEngine = engine;

  // Wire WS connections to the engine for presence tracking.
  const originalConnectionHandler = wss.listeners("connection").pop();
  wss.removeAllListeners("connection");
  wss.on("connection", (ws, req) => {
    // Call original handler first (sets up clientChannelIds, etc.).
    if (originalConnectionHandler) {
      originalConnectionHandler(ws, req);
    }

    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const channelId = url.searchParams.get("channelId");
    if (!channelId) return;

    const connectionId = crypto.randomUUID();
    (ws as any).__connectionId = connectionId;

    engine.addViewer(channelId, connectionId).catch((err) => {
      logger.error(`Failed to add viewer for ${channelId}`, "ws", err);
    });

    // Override close to also remove viewer from engine.
    const originalCloseHandler = ws.listeners("close").pop();
    ws.removeListener("close", originalCloseHandler as any);
    ws.on("close", () => {
      if (originalCloseHandler) (originalCloseHandler as any).call(ws);
      engine.removeViewer(channelId, connectionId);
    });
  });

  // Lightweight 30-second watcher for channels without viewers.
  // This catches the case where a session is due but no one has connected
  // yet — it calls handleGameLoopTick which starts the session via the
  // normal lock-and-start flow, and handleChannelTick will mark it as
  // continue=true, so the next viewer that arrives will trigger onActivate
  // and the engine will start ticking the channel.
  const WATCHER_INTERVAL_MS = 30_000;
  const watcherTimer = setInterval(async () => {
    try {
      await handleGameLoopTick(Date.now(), broadcast);
    } catch (err) {
      logger.error(
        "Game loop watcher failed",
        "game-loop",
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }, WATCHER_INTERVAL_MS);

  // For graceful shutdown.
  (httpServer as any).__cleanupGameLoop = () => {
    engine.stopAll();
    clearInterval(watcherTimer);
  };

  logger.info("Game loop: RealtimeEngine (per-channel, presence-triggered) + 30s watcher", "game-loop");

  return httpServer;
}

// ---------------------------------------------------------------------------
// handleGameLoopTick — thin wrapper for backward compatibility (tests import
// this with the same signature) and for the 30-second background watcher.
//
// Iterates all active channels and delegates per-channel state-machine logic
// to handleChannelTick in channel-tick.ts.
// ---------------------------------------------------------------------------

export async function handleGameLoopTick(
  now: number,
  broadcast: (channelId: ChannelId, message: WsMessage) => void,
) {
  try {
    const activeChannelIds = await storage.getActiveChannels();
    logger.debug(
      `[GameLoop] Checking ${activeChannelIds.length} active channels`,
      "game-loop",
    );

    for (const channel of activeChannelIds) {
      const result = await handleChannelTick(
        channel.channelId,
        now,
        broadcast,
        startSessionForChannelId,
      );
      // We don't act on the continue flag here — the watcher is best-effort.
      // The RealtimeEngine handles proper lifecycle when viewers are present.
      void result;
    }
  } catch (err) {
    logger.error(
      "Error in game loop tick",
      "game-loop",
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
