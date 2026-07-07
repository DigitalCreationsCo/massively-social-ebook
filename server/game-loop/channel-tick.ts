/**
 * Per-channel game-loop state machine.
 *
 * Extracted from the inner loop of `handleGameLoopTick` in routes/index.ts.
 * Each call processes one channel tick: loads cached state (or hydrates from
 * DB on cache miss), checks for phase transitions, performs AI generation
 * when needed, and broadcasts state to connected clients.
 *
 * The caller is responsible for:
 *   - Iterating over active channels
 *   - Acquiring/releasing the distributed game lock (tryAcquireGameLock /
 *     releaseGameLock)
 *   - Providing a `startSession` callback for session lifecycle
 *
 * Backward compatible: tests import `handleGameLoopTick` from routes/index.ts,
 * which internally delegates to this function.
 */

import { storage } from "../storage";
import { generateStoryBlock } from "../blocks/ai";
import { generateAndUploadStoryImage } from "../image-uploader";
import { logger } from "../logger";
import { formatInTZ } from "@shared/date";
import type { WsMessage, Block, Session } from "@shared/schema";

// ── Types ────────────────────────────────────────────────────────────────────

export type ChannelId = string;

export interface CachedChannelState {
  currentPhase: string;
  phaseEndsAt: Date;
  decisionEndsAt: Date;
  initialTimeToDecision: number;
  turnsToNextChoice: number;
  currentBlockId: number | null;
  activeSessionId: number | null;
}

export interface CachedBlock {
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

// ── Timing Constants ────────────────────────────────────────────────────────

export const NARRATIVE_TURN_MS = 40_000;
export const VOTING_PHASE_MS = 40_000;
export const POST_VOTE_READING_MS = 40_000;

export const LOBBY_DELAY_MS = 3 * 60 * 1000; // 3 minutes before start time
export const START_BEFORE_MS = LOBBY_DELAY_MS;
export const AFTERPARTY_MS = 3 * 60 * 1000;  // 3 minutes afterparty

export const PHASE_INITIAL_MS: Record<string, number> = {
  reading: NARRATIVE_TURN_MS,
  voting: VOTING_PHASE_MS,
  resolution: 60_000,
  afterparty: AFTERPARTY_MS,
};

// ── In-Memory Caches (no TTL — entries are authoritative until invalidated) ──

const stateCacheStore = new Map<string, CachedChannelState>();
const blockCacheStore = new Map<string, CachedBlock>();

export const stateCache = {
  get: (k: string) => stateCacheStore.get(k),
  set: (k: string, v: CachedChannelState) => stateCacheStore.set(k, v),
  invalidate: (k: string) => stateCacheStore.delete(k),
  keys: () => [...stateCacheStore.keys()],
};

export const blockCache = {
  get: (k: string) => blockCacheStore.get(k),
  set: (k: string, v: CachedBlock) => blockCacheStore.set(k, v),
  invalidate: (k: string) => blockCacheStore.delete(k),
  keys: () => [...blockCacheStore.keys()],
};

/** Clears both caches. Used by tests to reset state between cases. */
export function clearChannelCache(): void {
  stateCacheStore.clear();
  blockCacheStore.clear();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getRandomTurns(): number {
  return Math.floor(Math.random() * 3) + 2; // 2, 3, or 4
}

/**
 * Computes the wall-clock time when the next decision/voting phase will end.
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
  if (turns === 0) {
    return state.phaseEndsAt + VOTING_PHASE_MS;
  }
  return state.phaseEndsAt + turns * NARRATIVE_TURN_MS + VOTING_PHASE_MS;
}

// ── Pre-generation (fire-and-forget pending blocks) ──────────────────────────

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

// ── Session Start ────────────────────────────────────────────────────────────

export async function startSessionForChannelId(
  channelId: ChannelId,
  session: Session,
  broadcast: (channelId: ChannelId, message: WsMessage) => void,
) {
  logger.info(
    `Starting session "${session.title}" for channel ${channelId}`,
    "session",
  );

  let block = await storage.getCurrentBlock(channelId);
  let previousContext = "";

  if (!block) {
    const lastBlock = await storage.getLastBlock(channelId);
    if (lastBlock) {
      previousContext = `The story continues from where it left off:\n${lastBlock.content}`;
      block = lastBlock;
    }
  }

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
        ttsEnabled: false,
        optionA: { label: "Reboot", description: "Attempt a system reboot." },
        optionB: {
          label: "Wait",
          description: "Wait for the anomaly to clear.",
        },
      });
    }
  } else if (previousContext) {
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

  await storage.upsertChannelState(channelId, {
    currentPhase: "reading",
    phaseEndsAt,
    decisionEndsAt,
    initialTimeToDecision,
    turnsToNextChoice,
    currentBlockId: block.id,
    activeSessionId: session.id,
  });

  stateCache.set(channelId, {
    currentPhase: "reading",
    phaseEndsAt,
    decisionEndsAt,
    initialTimeToDecision,
    turnsToNextChoice,
    currentBlockId: block.id,
    activeSessionId: session.id,
  });
  blockCache.set(channelId, block as CachedBlock);

  pregenerateOption(channelId, block, "A");
  pregenerateOption(channelId, block, "B");

  await storage.updateSessionStatus(session.id, "active");

  broadcast(channelId, {
    type: "SESSION_STATUS",
    payload: { status: "active", session },
  });
}

// ── Per-Channel Tick ─────────────────────────────────────────────────────────

/**
 * Processes one tick for a single channel.
 *
 * Returns `{ continue: true }` if the session is still active and should
 * keep ticking. Returns `{ continue: false }` when the session has reached
 * its natural end (afterparty completed, session marked complete).
 *
 * Designed to be called either from the legacy `handleGameLoopTick` (which
 * iterates all active channels) or from the RealtimeEngine's `onTick`
 * callback (per-channel timer).
 */
export async function handleChannelTick(
  channelId: ChannelId,
  now: number,
  broadcast: (channelId: ChannelId, message: WsMessage) => void,
  startSession: (channelId: ChannelId, session: Session, broadcast: (channelId: ChannelId, message: WsMessage) => void) => Promise<void>,
): Promise<{ continue: boolean }> {
  try {
    let dbState = stateCache.get(channelId);

    if (!dbState) {
      const raw = await storage.getChannelState(channelId);
      if (raw) {
        const block = raw.currentBlockId
          ? await storage.getBlockById(raw.currentBlockId)
          : null;
        const cachedState: CachedChannelState = {
          currentPhase: raw.currentPhase,
          phaseEndsAt: raw.phaseEndsAt,
          decisionEndsAt: raw.decisionEndsAt,
          initialTimeToDecision: raw.initialTimeToDecision,
          turnsToNextChoice: raw.turnsToNextChoice,
          currentBlockId: raw.currentBlockId,
          activeSessionId: raw.activeSessionId,
        };
        stateCache.set(channelId, cachedState);
        if (block) blockCache.set(channelId, block as CachedBlock);
        dbState = cachedState;
      }
    }

    // ── Handle Inactive / Scheduled Channels ─────────────────────────────
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
          if (!isGameLoopLockAcquired) return { continue: false };

          try {
            await startSession(channelId, next, broadcast);
          } catch (err) {
            logger.error(`Failed to start session: ${err}`);
          }
        }
      }

      return { continue: false };
    }

    const activeSession = await storage.getSessionById(
      dbState.activeSessionId,
    );
    if (!activeSession) {
      await storage.upsertChannelState(channelId, {
        activeSessionId: null,
        currentBlockId: null,
      });
      return { continue: false };
    }

    // ── Session overrun: enter resolution phase ───────────────────────────
    if (
      dbState.currentPhase !== "resolution" &&
      dbState.currentPhase !== "afterparty" &&
      now >= activeSession.scheduledEnd.getTime()
    ) {
      const locked = await storage.tryAcquireGameLock(channelId, 90_000);
      if (!locked) return { continue: true };

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
          return { continue: true };
        }
        const resBlock = await storage.getBlockById(resolutionBlockId);
        if (!resBlock) {
          return { continue: true };
        }

        stateCache.set(channelId, {
          currentPhase: "resolution",
          phaseEndsAt: resPhaseEndsAt,
          decisionEndsAt: resPhaseEndsAt,
          initialTimeToDecision: 0,
          turnsToNextChoice: 0,
          currentBlockId: resolutionBlockId,
          activeSessionId: activeSession.id,
        });
        blockCache.set(channelId, resBlock as CachedBlock);

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
      return { continue: true };
    }

    // ── Resolution ended: enter afterparty phase ──────────────────────────
    if (
      dbState.currentPhase === "resolution" &&
      now >= dbState.phaseEndsAt.getTime()
    ) {
      const locked = await storage.tryAcquireGameLock(channelId, 10_000);
      if (!locked) return { continue: true };
      try {
        logger.info(
          `Entering afterparty for session "${activeSession.title}" on channel ${channelId}.`,
          "session",
        );

        const afterpartyEndsAt = new Date(now + AFTERPARTY_MS);
        const currentBlock = blockCache.get(channelId);

        await storage.upsertChannelState(channelId, {
          currentPhase: "afterparty",
          phaseEndsAt: afterpartyEndsAt,
          decisionEndsAt: afterpartyEndsAt,
        });

        stateCache.set(channelId, {
          ...dbState,
          currentPhase: "afterparty",
          phaseEndsAt: afterpartyEndsAt,
          decisionEndsAt: afterpartyEndsAt,
        });
        // block doesn't change

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
      return { continue: true };
    }

    // ── Afterparty ended: mark session complete ───────────────────────────
    if (
      dbState.currentPhase === "afterparty" &&
      now >= dbState.phaseEndsAt.getTime()
    ) {
      const locked = await storage.tryAcquireGameLock(channelId, 10_000);
      if (!locked) return { continue: true };
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
        stateCache.invalidate(channelId);
        blockCache.invalidate(channelId);

        broadcast(channelId, {
          type: "SESSION_STATUS",
          payload: { status: "completed", session: activeSession },
        });
      } finally {
        await storage.releaseGameLock(channelId);
      }
      return { continue: false };
    }

    // ── Normal game loop ─────────────────────────────────────────────────
    if (now >= dbState.phaseEndsAt.getTime()) {
      const locked = await storage.tryAcquireGameLock(channelId, 90_000);
      if (!locked) return { continue: true };

      try {
        const currentBlock = dbState.currentBlockId
          ? await storage.getBlockById(dbState.currentBlockId)
          : null;

        if (dbState.currentPhase === "reading") {
          if (dbState.turnsToNextChoice > 0) {
            // ── Narrative turn: advance story without a vote ──────────────
            let nextData: {
              title: string;
              content: string;
              imageUrl: string;
              dialogue?: string | null;
              optionA?: unknown;
              optionB?: unknown;
            };

            const pending = currentBlock
              ? await storage.getPendingBlock(currentBlock.id, "A")
              : null;

            if (pending) {
              nextData = {
                title: pending.title,
                content: pending.content,
                imageUrl: pending.imageUrl,
                dialogue: pending.dialogue,
                optionA: pending.optionA,
                optionB: pending.optionB,
              };
              await storage.deletePendingBlocksForBlock(currentBlock!.id);
            } else {
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

            stateCache.set(channelId, {
              currentPhase: "reading",
              phaseEndsAt: newPhaseEndsAt,
              decisionEndsAt: newDecisionEndsAt,
              initialTimeToDecision: dbState.initialTimeToDecision,
              turnsToNextChoice: newTurns,
              currentBlockId: newBlock.id,
              activeSessionId: activeSession.id,
            });
            blockCache.set(channelId, newBlock as CachedBlock);

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
            // ── Enter voting phase ────────────────────────────────────────
            const newPhaseEndsAt = new Date(now + VOTING_PHASE_MS);
            await storage.upsertChannelState(channelId, {
              currentPhase: "voting",
              phaseEndsAt: newPhaseEndsAt,
              decisionEndsAt: newPhaseEndsAt,
              initialTimeToDecision: VOTING_PHASE_MS,
            });

            if (currentBlock) {
              stateCache.set(channelId, {
                currentPhase: "voting",
                phaseEndsAt: newPhaseEndsAt,
                decisionEndsAt: newPhaseEndsAt,
                initialTimeToDecision: VOTING_PHASE_MS,
                turnsToNextChoice: 0,
                currentBlockId: currentBlock.id,
                activeSessionId: activeSession.id,
              });
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
          // ── Voting phase ended: tally and advance ───────────────────────
          const votes = currentBlock
            ? await storage.getVotesForBlock(currentBlock.id)
            : [];
          const countA = votes.filter((v) => v.choice === "A").length;
          const countB = votes.filter((v) => v.choice === "B").length;
          const winner: "A" | "B" = countA >= countB ? "A" : "B";

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
            dialogue?: string | null;
            ttsEnabled?: boolean;
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
                dialogue: pending.dialogue,
                optionA: pending.optionA,
                optionB: pending.optionB,
              };
              await storage.deletePendingBlocksForBlock(currentBlock!.id);
            } else {
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
              "Failed to adopt next block, advancing with fallback",
              "gameloop",
              err instanceof Error ? err : new Error(String(err)),
            );
            nextData = {
              title: "Temporal Distortion",
              content:
                "A temporal distortion disrupts the timeline. We must re-establish connection.",
              imageUrl: "/images/img_1771936309521_ieycq2.jpg",
              ttsEnabled: false,
              optionA: {
                label: "Reconnect",
                description: "Attempt to reconnect to the timeline.",
              },
              optionB: {
                label: "Wait",
                description: "Wait for the distortion to pass.",
              },
            };
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

          stateCache.set(channelId, {
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
          });
          blockCache.set(channelId, newBlock as CachedBlock);

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
      // ── Heartbeat broadcast ─────────────────────────────────────────────
      let blockForHeartbeat = blockCache.get(channelId);
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
        return { continue: true };
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

    return { continue: true };
  } catch (err) {
    logger.error(
      `Unhandled error in game loop for channel ${channelId}`,
      "gameloop",
      err instanceof Error ? err : new Error(String(err)),
    );
    return { continue: true };
  }
}
