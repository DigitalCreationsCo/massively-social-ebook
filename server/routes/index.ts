import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "../storage";
import { generateStoryBlock } from "../blocks/ai";
import { generateAndUploadStoryImage } from "../image-uploader";
import { api } from "@shared/routes";
import {
  WS_EVENTS,
  type WsMessage,
  type Block,
  type Session,
  sessions,
  blocks,
  chat,
} from "@shared/schema";
import { trackUserEmail } from "../analytics";
import { CalendarService } from "../calendar";
import { isAdmin, isDevOnly } from "../middleware/auth";
import { logger } from "../logger";
import { formatInTZ } from "@shared/date";
import { and, asc, desc, eq, sql, SQL } from "drizzle-orm";
import { db } from "server/db";

type ChannelId = string;

// Phase duration constants (milliseconds)
export const NARRATIVE_TURN_MS = 40_000;
export const VOTING_PHASE_MS = 40_000;
export const POST_VOTE_READING_MS = 40_000;

// Session timing constants (milliseconds)
export const LOBBY_DELAY_MS = 3 * 60 * 1000; // 3 minutes before start time (lobby/gathering)
export const START_BEFORE_MS = LOBBY_DELAY_MS; // Alias for clarity
export const AFTERPARTY_MS = 3 * 60 * 1000; // 3 minutes afterparty after resolution ends

export const PHASE_INITIAL_MS: Record<string, number> = {
  reading: NARRATIVE_TURN_MS,
  voting: VOTING_PHASE_MS,
  resolution: 60_000,
  afterparty: AFTERPARTY_MS,
};

function getRandomTurns() {
  return Math.floor(Math.random() * 3) + 2; // 2, 3, or 4
}

/**
 * Computes the wall-clock time when the next decision/voting phase will end.
 * - In voting phase: decision ends at the same time as the current phase.
 * - In reading phase: decision ends at phaseEndsAt + remainingTurns * NARRATIVE_TURN_MS.
 *   If turnsToNextChoice is 0, the next tick will enter voting, so decision
 *   ends at the current phaseEndsAt + VOTING_PHASE_MS.
 */
export function computeDecisionEndsAt(state: {
  currentPhase: string;
  phaseEndsAt: number;
  turnsToNextChoice: number;
}): number {
  if (state.currentPhase === "voting") {
    return state.phaseEndsAt;
  }
  if (state.currentPhase === "resolution" || state.currentPhase === "afterparty") {
    return state.phaseEndsAt;
  }
  // reading phase
  const turns = Math.max(0, state.turnsToNextChoice);
  // The phaseEndsAt is when the current reading block ends.
  // After that, if turns > 0, each remaining turn adds NARRATIVE_TURN_MS.
  // After turns reach 0, voting adds VOTING_PHASE_MS.
  if (turns === 0) {
    return state.phaseEndsAt + VOTING_PHASE_MS;
  }
  // turns remaining: each turn = NARRATIVE_TURN_MS, then VOTING_PHASE_MS at the end
  return state.phaseEndsAt + turns * NARRATIVE_TURN_MS + VOTING_PHASE_MS;
}

/** Clears the in-memory channel cache. Used by tests to reset state between cases. */
export function clearChannelCache(): void {
  channelCache.clear();
}

// ---------------------------------------------------------------------------
// In-Memory Channel State Cache (avoids DB reads during heartbeat)
//
// Key insight: block content is immutable once created - only timers change.
// We cache the full block + channel state in memory, hitting DB only on:
//   - Phase transitions (when block changes)
//   - Initial load / reconnect
//   - Cache miss (multi-instance: one instance writes, others may miss)
//
// Cache TTL: 500ms (half tick) - stale cache just means extra DB read on next tick,
//             not incorrect data.
// ---------------------------------------------------------------------------

interface CachedChannelState {
  currentPhase: string;
  phaseEndsAt: Date;
  decisionEndsAt: Date;
  initialTimeToDecision: number;
  turnsToNextChoice: number;
  currentBlockId: number | null;
  activeSessionId: number | null;
}

// Alias for readability - cache uses 'phase' but DB returns 'currentPhase'
const getPhase = (state: CachedChannelState): string => state.currentPhase;

interface CachedBlock {
  id: number;
  channelId: string;
  sessionId: number;
  title: string;
  content: string;
  imageUrl: string;
  optionA: unknown;
  optionB: unknown;
  createdAt: Date;
}

interface ChannelCacheEntry {
  state: CachedChannelState;
  block: CachedBlock | null;
  lastUpdated: number; // timestamp for TTL checking
}

// Per-channel in-memory cache - survives across ticks, refreshed on transitions
const channelCache = new Map<ChannelId, ChannelCacheEntry>();

// Cache TTL: 500ms - effectively fresh between ticks, but safe if an instance
// that created the cache dies (another instance will rebuild on next tick)
const CACHE_TTL_MS = 500;

function updateChannelCache(
  channelId: ChannelId,
  state: CachedChannelState,
  block: CachedBlock | null,
) {
  channelCache.set(channelId, {
    state,
    block,
    lastUpdated: Date.now(),
  });
}

function getCachedBlock(channelId: ChannelId): CachedBlock | null {
  const entry = channelCache.get(channelId);
  if (!entry) return null;

  if (Date.now() - entry.lastUpdated > CACHE_TTL_MS) {
    channelCache.delete(channelId);
    return null;
  }
  return entry.block;
}

function getCachedState(channelId: ChannelId): CachedChannelState | null {
  const entry = channelCache.get(channelId);
  if (!entry) return null;

  if (Date.now() - entry.lastUpdated > CACHE_TTL_MS) {
    channelCache.delete(channelId);
    return null;
  }
  return entry.state;
}

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
// Pre-generation — fire-and-forget writes to the pending_blocks table.
//
// The old code stashed Promises in ChannelIdState.nextBlockA/B.  Those die
// with the process.  Now we write the result to the DB so any instance
// (or a restarted instance) can consume it at resolution time.
// ---------------------------------------------------------------------------

function pregenerateOption(
  channelId: ChannelId,
  currentBlock: Block,
  option: "A" | "B",
): void {
  const opt = option === "A" ? currentBlock.optionA : currentBlock.optionB;
  const optData = opt as { label?: string; description?: string } | null;
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
        imageUrl = await generateAndUploadStoryImage(
          nextContent.content,
          channelId,
          "pending",
        );
      } catch (imageErr) {
        logger.warn(
          `Image generation failed for ${channelId} option ${option}, using fallback`,
          "ai",
          imageErr,
        );
        imageUrl =
          (await storage.getRandomImage(channelId)) ||
          "/images/img_1771936309521_ieycq2.jpg";
      }

      await storage.savePendingBlock({
        channelId,
        forBlockId: currentBlock.id,
        choice: option,
        ...nextContent,
        imageUrl,
      });
      logger.debug(
        `Saved pending block for ${channelId} option ${option} (forBlock ${currentBlock.id})`,
        "ai",
      );
    } catch (err) {
      logger.error(
        `Failed to pregenerate option ${option} for ${channelId}`,
        "routes",
        err instanceof Error ? err : new Error(String(err)),
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
  broadcast: (channelId: ChannelId, message: WsMessage) => void,
) {
  logger.info(
    `Starting session "${session.title}" for channel ${channelId}`,
    "session",
  );

  // Seed or resume: get current block for active session, or last block from previous session
  let block = await storage.getCurrentBlock(channelId);
  let previousContext = "";

  // If no current block, try to get the last block from previous sessions
  if (!block) {
    const lastBlock = await storage.getLastBlock(channelId);
    if (lastBlock) {
      // Resume from previous session - use last block as context for story continuation
      previousContext = `The story continues from where it left off:\n${lastBlock.content}`;
      block = lastBlock;
    }
  }

  // If still no block, generate new one using session description
  if (!block) {
    const initialPrompt = session.description ?? "";
    try {
      const nextContent = await generateStoryBlock(
        channelId,
        initialPrompt,
        false,
        session.id,
      );
      let imageUrl: string;
      try {
        imageUrl = await generateAndUploadStoryImage(nextContent.content, channelId, "block");
      } catch {
        imageUrl =
          (await storage.getRandomImage(channelId)) ||
          "/images/img_1771936309521_ieycq2.jpg";
      }
      block = await storage.createBlock({
        channelId,
        sessionId: session.id,
        ...nextContent,
        imageUrl,
      });
    } catch (err) {
      logger.error(
        "Failed to generate initial block",
        "session",
        err instanceof Error ? err : new Error(String(err)),
      );
      block = await storage.createBlock({
        channelId,
        sessionId: session.id,
        title: "System Reboot",
        content:
          "The story system encountered an anomaly and is attempting to reboot.",
        imageUrl: "/images/img_1771936309521_ieycq2.jpg",
        optionA: { label: "Reboot", description: "Attempt a system reboot." },
        optionB: {
          label: "Wait",
          description: "Wait for the anomaly to clear.",
        },
      });
    }
  } else if (previousContext) {
    // We have a block from previous session - generate next block continuing the story
    try {
      const nextContent = await generateStoryBlock(
        channelId,
        previousContext,
        false,
        session.id,
      );
      let imageUrl: string;
      try {
        imageUrl = await generateAndUploadStoryImage(nextContent.content, channelId, "block");
      } catch {
        imageUrl =
          (await storage.getRandomImage(channelId)) ||
          "/images/img_1771936309521_ieycq2.jpg";
      }
      block = await storage.createBlock({
        channelId,
        sessionId: session.id,
        ...nextContent,
        imageUrl,
      });
    } catch (err) {
      logger.error(
        "Failed to generate continuation block",
        "session",
        err instanceof Error ? err : new Error(String(err)),
      );
      // Keep using the last block as-is
    }
  }

  const now = Date.now();
  const phaseEndsAt = new Date(now + LOBBY_DELAY_MS + POST_VOTE_READING_MS);
  const turnsToNextChoice = getRandomTurns();
  const decisionEndsAt = new Date(
    phaseEndsAt.getTime() + turnsToNextChoice * NARRATIVE_TURN_MS,
  );
  const initialTimeToDecision = Math.max(
    0,
    decisionEndsAt.getTime() - now - LOBBY_DELAY_MS,
  );

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

  updateChannelCache(
    channelId,
    {
      currentPhase: "reading",
      phaseEndsAt,
      decisionEndsAt,
      initialTimeToDecision,
      turnsToNextChoice,
      currentBlockId: block.id,
      activeSessionId: session.id,
    },
    block as CachedBlock,
  );

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
  logger.info("Starting game loop (1-second tick)", "game-loop");
  setInterval(async () => {
    try {
      await handleGameLoopTick(Date.now(), broadcast);
    } catch (err) {
      logger.error(
        "Game loop tick failed",
        "game-loop",
        err instanceof Error ? err : new Error(String(err)),
      );
    }
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
  broadcast: (channelId: ChannelId, message: WsMessage) => void,
) {
  try {
    const activeChannelIds = await storage.getActiveChannels();
    logger.debug(
      `[GameLoop] Checking ${activeChannelIds.length} active channels`,
      "game-loop",
    );

    for (const channel of activeChannelIds) {
      const channelId = channel.channelId;
      try {
        let dbState = getCachedState(channelId);

        if (!dbState) {
          dbState = await storage.getChannelState(channelId);
          if (dbState) {
            const block = dbState.currentBlockId
              ? await storage.getBlockById(dbState.currentBlockId)
              : null;
            updateChannelCache(
              channelId,
              {
                currentPhase: dbState.currentPhase,
                phaseEndsAt: dbState.phaseEndsAt,
                decisionEndsAt: dbState.decisionEndsAt,
                initialTimeToDecision: dbState.initialTimeToDecision,
                turnsToNextChoice: dbState.turnsToNextChoice,
                currentBlockId: dbState.currentBlockId,
                activeSessionId: dbState.activeSessionId,
              },
              block as CachedBlock | null,
            );
          }
        }

        // ── Handle Inactive / Scheduled Channels ─────────────────────
        if (!dbState?.activeSessionId) {
          const next = await storage.getNextSession(channelId);

          if (next) {
            const startThreshold =
              next.scheduledStart.getTime() - START_BEFORE_MS;
            if (now >= startThreshold) {
              const isGameLoopLockAcquired = await storage.tryAcquireGameLock(
                channelId,
                30_000,
              );
              if (!isGameLoopLockAcquired) continue;

              try {
                await startSessionForChannelId(channelId, next, broadcast);
              } catch (err) {
                logger.error(`Failed to start session: ${err}`);
              }
            }
          }

          // ── ADD THIS LINE ──────────────────────────────────────────
          // This prevents the code below (the Heartbeat) from running
          // for a channel that doesn't have an active session yet.
          continue;
          // ───────────────────────────────────────────────────────────
        }
        const activeSession = await storage.getSessionById(
          dbState.activeSessionId,
        );
        if (!activeSession) {
          // Stale FK — clear it so we don't loop forever on a missing session.
          await storage.upsertChannelState(channelId, {
            activeSessionId: null,
            currentBlockId: null,
          });
          continue;
        }

        // ── Session overrun: enter resolution phase ───────────────────────
        // Skip if already in afterparty — that follows resolution and leads
        // to session completion on its own timer.
        if (
          dbState.currentPhase !== "resolution" &&
          dbState.currentPhase !== "afterparty" &&
          now >= activeSession.scheduledEnd.getTime()
        ) {
          const locked = await storage.tryAcquireGameLock(channelId, 90_000);
          if (!locked) continue;
          try {
            logger.info(
              `Session "${activeSession.title}" reaching scheduled end. Entering resolution.`,
              "session",
            );

            let resolutionBlockId = dbState.currentBlockId;
            const currentBlock = dbState.currentBlockId
              ? await storage.getBlockById(dbState.currentBlockId)
              : null;

            if (currentBlock) {
              try {
                const previousContext = `Previous event: ${currentBlock.content}`;
                const nextContent = await generateStoryBlock(
                  channelId,
                  previousContext,
                  true,
                );
                let imageUrl: string;
                try {
                  imageUrl = await generateAndUploadStoryImage(nextContent.content, channelId, "block");
                } catch {
                  imageUrl =
                    (await storage.getRandomImage(channelId)) ||
                    "/images/img_1771936309521_ieycq2.jpg";
                }
                const resBlock = await storage.createBlock({
                  channelId,
                  sessionId: activeSession.id,
                  ...nextContent,
                  imageUrl,
                });
                resolutionBlockId = resBlock.id;
                logger.info(
                  `Resolution block generated: ${resBlock.id}`,
                  "gameloop",
                );
              } catch (err) {
                logger.error(
                  "Failed to generate resolution block",
                  "gameloop",
                  err instanceof Error ? err : new Error(String(err)),
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

            if (!resolutionBlockId) {
              break;
            }
            const resBlock = await storage.getBlockById(resolutionBlockId);
            if (!resBlock) {
              break;
            }
            updateChannelCache(
              channelId,
              {
                currentPhase: "resolution",
                phaseEndsAt: resPhaseEndsAt,
                decisionEndsAt: resPhaseEndsAt,
                initialTimeToDecision: 0,
                turnsToNextChoice: 0,
                currentBlockId: resolutionBlockId,
                activeSessionId: activeSession.id,
              },
              resBlock as CachedBlock,
            );

            broadcast(channelId, {
              type: "SYNC_STATE",
              payload: {
                ...resBlock,
                createdAt:
                  resBlock.createdAt?.toISOString() ?? new Date().toISOString(),
                phase: "resolution",
                timeRemaining: 60_000,
                timeToNextDecision: 0,
                initialTimeToNextDecision: 0,
                turnsToNextChoice: 0,
                phaseInitialMs: 60_000,
              },
            });
          } finally {
            await storage.releaseGameLock(channelId);
          }
          continue;
        }

        // ── Resolution ended: enter afterparty phase ──────────────────────
        if (
          dbState.currentPhase === "resolution" &&
          now >= dbState.phaseEndsAt.getTime()
        ) {
          const locked = await storage.tryAcquireGameLock(channelId, 10_000);
          if (!locked) continue;
          try {
            logger.info(
              `Entering afterparty for session "${activeSession.title}" on channel ${channelId}.`,
              "session",
            );

            const afterpartyEndsAt = new Date(now + AFTERPARTY_MS);
            const currentBlock = getCachedBlock(channelId);

            await storage.upsertChannelState(channelId, {
              currentPhase: "afterparty",
              phaseEndsAt: afterpartyEndsAt,
              decisionEndsAt: afterpartyEndsAt,
            });

            updateChannelCache(
              channelId,
              {
                ...dbState,
                currentPhase: "afterparty",
                phaseEndsAt: afterpartyEndsAt,
                decisionEndsAt: afterpartyEndsAt,
              },
              currentBlock as CachedBlock | null,
            );

            broadcast(channelId, {
              type: "SYNC_STATE",
              payload: {
                ...(currentBlock ?? {}),
                createdAt:
                  currentBlock?.createdAt?.toISOString() ??
                  new Date().toISOString(),
                phase: "afterparty",
                timeRemaining: AFTERPARTY_MS,
                timeToNextDecision: 0,
                initialTimeToNextDecision: 0,
                turnsToNextChoice: 0,
                phaseInitialMs: AFTERPARTY_MS,
              },
            });
          } finally {
            await storage.releaseGameLock(channelId);
          }
          continue;
        }

        // ── Afterparty ended: mark session complete ───────────────────────
        if (
          dbState.currentPhase === "afterparty" &&
          now >= dbState.phaseEndsAt.getTime()
        ) {
          const locked = await storage.tryAcquireGameLock(channelId, 10_000);
          if (!locked) continue;
          try {
            logger.info(
              `Ending session "${activeSession.title}" for channel ${channelId} after afterparty.`,
              "session",
            );
            await storage.updateSessionStatus(activeSession.id, "completed");
            await storage.upsertChannelState(channelId, {
              activeSessionId: null,
              currentBlockId: null,
              currentPhase: "reading",
            });

            // Clear cache on session end
            channelCache.delete(channelId);

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
                  const optData = opt as {
                    label?: string;
                    description?: string;
                  } | null;
                  const winnerText = `${optData?.label || "Choice A"}: ${optData?.description || "The story continues..."}`;
                  const previousContext = `${currentBlock?.title ?? ""}\n${currentBlock?.content ?? ""}${winnerText}`;
                  const nextContent = await generateStoryBlock(
                    channelId,
                    previousContext,
                  );
                  let imageUrl: string;
                  try {
                    imageUrl = await generateAndUploadStoryImage(nextContent.content, channelId, "block");
                  } catch {
                    imageUrl =
                      (await storage.getRandomImage(channelId)) ||
                      "/images/img_1771936309521_ieycq2.jpg";
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
                const newDecisionEndsAt = new Date(
                  newPhaseEndsAt.getTime() + newTurns * NARRATIVE_TURN_MS,
                );

                await storage.upsertChannelState(channelId, {
                  currentBlockId: newBlock.id,
                  turnsToNextChoice: newTurns,
                  phaseEndsAt: newPhaseEndsAt,
                  decisionEndsAt: newDecisionEndsAt,
                });

                updateChannelCache(
                  channelId,
                  {
                    currentPhase: "reading",
                    phaseEndsAt: newPhaseEndsAt,
                    decisionEndsAt: newDecisionEndsAt,
                    initialTimeToDecision: dbState.initialTimeToDecision,
                    turnsToNextChoice: newTurns,
                    currentBlockId: newBlock.id,
                    activeSessionId: activeSession.id,
                  },
                  newBlock as CachedBlock,
                );

                pregenerateOption(channelId, newBlock, "A");
                pregenerateOption(channelId, newBlock, "B");

                logger.info(
                  `Advanced story to block ${newBlock.id}`,
                  "gameloop",
                );
                logger.debug(
                  `Narrative turn. Turns remaining: ${newTurns}, ` +
                    `Next phase ends at: ${formatInTZ(newPhaseEndsAt.getTime(), "UTC", "h:mm:ss a")} UTC, ` +
                    `Time to decision: ${Math.round((newDecisionEndsAt.getTime() - now) / 1000)}s`,
                  "gameloop",
                );

                broadcast(channelId, {
                  type: "SYNC_STATE",
                  payload: {
                    ...newBlock,
                    createdAt:
                      newBlock.createdAt?.toISOString() ??
                      new Date().toISOString(),
                    phase: "reading",
                    timeRemaining: NARRATIVE_TURN_MS,
                    timeToNextDecision: Math.max(
                      0,
                      newDecisionEndsAt.getTime() - now,
                    ),
                    initialTimeToNextDecision: dbState.initialTimeToDecision,
                    turnsToNextChoice: newTurns,
                    phaseInitialMs: NARRATIVE_TURN_MS,
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

                if (currentBlock) {
                  updateChannelCache(
                    channelId,
                    {
                      currentPhase: "voting",
                      phaseEndsAt: newPhaseEndsAt,
                      decisionEndsAt: newPhaseEndsAt,
                      initialTimeToDecision: VOTING_PHASE_MS,
                      turnsToNextChoice: 0,
                      currentBlockId: currentBlock.id,
                      activeSessionId: activeSession.id,
                    },
                    currentBlock as CachedBlock,
                  );
                }

                logger.info(
                  `ENTERING VOTING PHASE. Ends at: ${formatInTZ(newPhaseEndsAt.getTime(), "UTC", "h:mm:ss a")} UTC`,
                  "gameloop",
                );

                if (currentBlock) {
                  broadcast(channelId, {
                    type: "SYNC_STATE",
                    payload: {
                      ...currentBlock,
                      createdAt:
                        currentBlock.createdAt?.toISOString() ??
                        new Date().toISOString(),
                      phase: "voting",
                      timeRemaining: VOTING_PHASE_MS,
                      timeToNextDecision: VOTING_PHASE_MS,
                      initialTimeToNextDecision: VOTING_PHASE_MS,
                      turnsToNextChoice: 0,
                      phaseInitialMs: VOTING_PHASE_MS,
                    },
                  });
                }
              }
            } else if (dbState.currentPhase === "voting") {
              // ── Voting phase ended: tally and advance ─────────────────
              const votes = currentBlock
                ? await storage.getVotesForBlock(currentBlock.id)
                : [];
              const countA = votes.filter((v) => v.choice === "A").length;
              const countB = votes.filter((v) => v.choice === "B").length;
              const winner: "A" | "B" = countA >= countB ? "A" : "B";

              // Create lore entry for the vote outcome
              if (currentBlock && activeSession) {
                const optA = currentBlock.optionA as { label?: string; description?: string } | null;
                const optB = currentBlock.optionB as { label?: string; description?: string } | null;
                const winnerLabel = winner === "A"
                  ? (optA?.label || "Choice A")
                  : (optB?.label || "Choice B");
                const loserLabel = winner === "A"
                  ? (optB?.label || "Choice B")
                  : (optA?.label || "Choice A");
                const loreContent = `Vote outcome for block "${currentBlock.title || "untitled"}": "${winnerLabel}" won (A: ${countA}, B: ${countB}) over "${loserLabel}".`;
                try {
                  await storage.createLore({
                    channelId,
                    content: loreContent,
                    isActive: true,
                  });
                  logger.info(`Created lore entry for vote outcome on block ${currentBlock.id}`, "gameloop");
                } catch (loreErr) {
                  logger.error("Failed to create lore for vote outcome", "gameloop", loreErr instanceof Error ? loreErr : new Error(String(loreErr)));
                }
              }

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
                  const opt =
                    winner === "A"
                      ? currentBlock?.optionA
                      : currentBlock?.optionB;
                  const optData = opt as {
                    label?: string;
                    description?: string;
                  } | null;
                  const winnerText = `${optData?.label || `Choice ${winner}`}: ${optData?.description || `The readers chose option ${winner}`}`;
                  const previousContext = `Previous event: ${currentBlock?.content ?? ""}\nThe readers chose: ${winnerText}`;
                  const nextContent = await generateStoryBlock(
                    channelId,
                    previousContext,
                  );
                  let imageUrl: string;
                  try {
                    imageUrl = await generateAndUploadStoryImage(nextContent.content, channelId, "block");
                  } catch {
                    logger.warn(
                      `Game loop image generation failed for ${channelId}, using fallback`,
                      "gameloop",
                    );
                    imageUrl =
                      (await storage.getRandomImage(channelId)) ||
                      "/images/img_1771936309521_ieycq2.jpg";
                  }
                  nextData = { ...nextContent, imageUrl };
                }
              } catch (err) {
                logger.error(
                  "Failed to adopt next block, will retry on next tick",
                  "gameloop",
                  err instanceof Error ? err : new Error(String(err)),
                );
                throw err;
              }

              const newBlock = await storage.createBlock({
                channelId,
                sessionId: activeSession.id,
                ...nextData,
              } as any);

              const newTurns = getRandomTurns();
              const newPhaseEndsAt = new Date(now + POST_VOTE_READING_MS);
              const newDecisionEndsAt = new Date(
                newPhaseEndsAt.getTime() + newTurns * NARRATIVE_TURN_MS,
              );

              await storage.upsertChannelState(channelId, {
                currentPhase: "reading",
                currentBlockId: newBlock.id,
                turnsToNextChoice: newTurns,
                phaseEndsAt: newPhaseEndsAt,
                decisionEndsAt: newDecisionEndsAt,
                initialTimeToDecision: Math.max(
                  0,
                  newDecisionEndsAt.getTime() - now,
                ),
              });

              updateChannelCache(
                channelId,
                {
                  currentPhase: "reading",
                  phaseEndsAt: newPhaseEndsAt,
                  decisionEndsAt: newDecisionEndsAt,
                  initialTimeToDecision: Math.max(
                    0,
                    newDecisionEndsAt.getTime() - now,
                  ),
                  turnsToNextChoice: newTurns,
                  currentBlockId: newBlock.id,
                  activeSessionId: activeSession.id,
                },
                newBlock as CachedBlock,
              );

              pregenerateOption(channelId, newBlock, "A");
              pregenerateOption(channelId, newBlock, "B");

              logger.info(
                `VOTING ENDED. Starting reading phase with ${newTurns} turns. ` +
                  `Overall ends at: ${formatInTZ(newDecisionEndsAt.getTime(), "UTC", "h:mm:ss a")} UTC`,
                "gameloop",
              );

              broadcast(channelId, {
                type: "SYNC_STATE",
                payload: {
                  ...newBlock,
                  createdAt:
                    newBlock.createdAt?.toISOString() ??
                    new Date().toISOString(),
                  currentPhase: "reading",
                  timeRemaining: POST_VOTE_READING_MS,
                  timeToNextDecision: Math.max(
                    0,
                    newDecisionEndsAt.getTime() - now,
                  ),
                  initialTimeToNextDecision: Math.max(
                    0,
                    newDecisionEndsAt.getTime() - now,
                  ),
                  turnsToNextChoice: newTurns,
                  phaseInitialMs: POST_VOTE_READING_MS,
                },
              });
            }
          } catch (err) {
            logger.error(
              `Game loop transition error for ${channelId}`,
              "gameloop",
              err instanceof Error ? err : new Error(String(err)),
            );
          } finally {
            await storage.releaseGameLock(channelId);
          }
        } else {
          // Heartbeat broadcast — every tick, send current state so clients
          // keep their timers in sync.  If the block is temporarily unavailable
          // (cold cache + DB hiccup) we skip this tick — the next tick (1s
          // later) will retry.  Broadcasting empty block fields would overwrite
          // the client's valid block cache with id=0 / null content.
          let blockForHeartbeat = getCachedBlock(channelId);
          if (!blockForHeartbeat && dbState.currentBlockId) {
            try {
              const fetched = await storage.getBlockById(dbState.currentBlockId);
              if (fetched) {
                blockForHeartbeat = fetched as CachedBlock;
              }
            } catch {
              // Non-fatal — skip broadcast this tick.
            }
          }

          if (!blockForHeartbeat) {
            continue;
          }

          broadcast(channelId, {
            type: "SYNC_STATE",
            payload: {
              ...blockForHeartbeat,
              createdAt:
                blockForHeartbeat.createdAt?.toISOString() ??
                new Date().toISOString(),
              phase: dbState.currentPhase,
              timeRemaining: Math.max(0, dbState.phaseEndsAt.getTime() - now),
              timeToNextDecision: Math.max(
                0,
                dbState.decisionEndsAt.getTime() - now,
              ),
              initialTimeToNextDecision: dbState.initialTimeToDecision,
              turnsToNextChoice: dbState.turnsToNextChoice,
              phaseInitialMs: PHASE_INITIAL_MS[dbState.currentPhase] ?? NARRATIVE_TURN_MS,
            },
          });
        }
      } catch (err) {
        logger.error(
          `Unhandled error in game loop for channel ${channelId}`,
          "gameloop",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  } catch (err) {
    logger.error(
      "Error in game loop tick",
      "gameloop",
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
