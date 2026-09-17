import {
  InMemoryFanoutBus,
  Polls,
} from "@portalshq/capability-realtime-fanout";
import { db } from "../db";
import { votes } from "@shared/schema";
import { logger } from "../logger";

const CHOICE_TO_INDEX = { A: 0, B: 1 } as const;
const INDEX_TO_CHOICE = ["A", "B"] as const;

/**
 * Conservative voting service over the portals `Polls` capability.
 *
 * `Polls` owns the live tally; the legacy `votes` table is kept as an
 * audit trail only (best-effort dual write, never on the critical path).
 * No routes are wired to this service yet — callers opt in explicitly.
 */
export class PollService {
  private readonly polls: Polls;

  constructor(bus?: InMemoryFanoutBus) {
    this.polls = new Polls(bus ?? new InMemoryFanoutBus());
  }

  async openPoll(sessionId: string, pollId: string, question: string): Promise<void> {
    await this.polls.open({ sessionId, pollId, question, options: ["A", "B"] });
  }

  async submitVote(audit: { channelId: string; sessionDbId: number; blockDbId: number } | null, poll: { sessionId: string; pollId: string }, voterId: string, choice: "A" | "B"): Promise<void> {
    await this.polls.vote({ pollId: poll.pollId, voterId, optionIndex: CHOICE_TO_INDEX[choice] });
    if (audit !== null) {
      try {
        await db.insert(votes).values({
          channelId: audit.channelId,
          sessionId: audit.sessionDbId,
          blockId: audit.blockDbId,
          userId: voterId,
          choice,
        });
      } catch (cause) {
        logger.warn("Poll audit write failed; live tally already recorded", "polls", cause);
      }
    }
  }

  async tally(sessionId: string, pollId: string): Promise<{ A: number; B: number }> {
    const { tally } = await this.polls.close(sessionId, pollId);
    return {
      A: tally[0] ?? 0,
      B: tally[1] ?? 0,
    };
  }

  static choiceFromIndex(index: number): "A" | "B" {
    return INDEX_TO_CHOICE[index] === "B" ? "B" : "A";
  }
}

export const pollService = new PollService();
