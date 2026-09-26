import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { promptRequests, type PromptRequest } from "@shared/schema";
import { ENTITLEMENT, getEntitlementStore, getStore } from "./monetization";

export const MONETIZATION_PRODUCTS = {
  superchat_1: {
    key: "superchat_1",
    name: "Story Superchat",
    description: "Put one audience direction into the next story window.",
    amount: 100,
    currency: "usd",
    kind: "super_chat" as const,
  },
  superchat_5: {
    key: "superchat_5",
    name: "Director's Cue",
    description: "A priority story direction with a highlighted room message.",
    amount: 500,
    currency: "usd",
    kind: "super_chat" as const,
  },
  founding_member: {
    key: "founding_member",
    name: "Founding Member",
    description: "A permanent founding badge and early access to new live experiences.",
    amount: 2900,
    currency: "usd",
    kind: "founding_member" as const,
  },
} as const;

export type MonetizationProductKey = keyof typeof MONETIZATION_PRODUCTS;

export function getMonetizationProduct(productKey: string) {
  return MONETIZATION_PRODUCTS[productKey as MonetizationProductKey];
}

export function publicCatalog() {
  return Object.values(MONETIZATION_PRODUCTS).map((product) => ({
    key: product.key,
    name: product.name,
    description: product.description,
    amount: product.amount,
    currency: product.currency,
    kind: product.kind,
    requiresPrompt: product.kind === "super_chat",
  }));
}

/**
 * Queues the direction a superchat bought, before checkout starts. The prompt is
 * the deliverable the purchase pays for, so it is recorded up front and linked
 * by `purchaseId` for auditing; the coordinator later spends the entitlement
 * credit that settlement grants.
 */
export async function queuePrompt(
  channelId: string,
  userId: number,
  promptText: string,
  purchaseId: string,
): Promise<void> {
  await db.insert(promptRequests).values({ channelId, userId, promptText, purchaseId });
}

/**
 * Queued directions, oldest first. Bounded because the claim path scans them:
 * the head of the queue is not always claimable, and an unbounded scan would let
 * one unpayable row cost a query proportional to the whole backlog.
 */
export async function getQueuedPrompts(channelId: string, limit: number): Promise<PromptRequest[]> {
  return db
    .select()
    .from(promptRequests)
    .where(and(eq(promptRequests.channelId, channelId), eq(promptRequests.status, "queued")))
    .orderBy(asc(promptRequests.createdAt), asc(promptRequests.id))
    .limit(limit);
}

/**
 * Claims a queued prompt by flipping it to `applied`, and reports whether this
 * caller won the race. The conditional `status = 'queued'` predicate is the lock,
 * so two coordinators cannot claim the same prompt.
 */
export async function claimPrompt(promptId: number): Promise<boolean> {
  const rows = await db
    .update(promptRequests)
    .set({ status: "applied", fulfilledAt: new Date() })
    .where(and(eq(promptRequests.id, promptId), eq(promptRequests.status, "queued")))
    .returning({ id: promptRequests.id });
  return rows.length > 0;
}

/**
 * Returns a claimed prompt to the queue. Called when the credit it was claimed
 * for could not be spent, so a purchase is never silently dropped.
 */
export async function releasePrompt(promptId: number): Promise<void> {
  await db
    .update(promptRequests)
    .set({ status: "queued", fulfilledAt: null })
    .where(and(eq(promptRequests.id, promptId), eq(promptRequests.status, "applied")));
}

/**
 * Discards a direction whose purchase never started.
 *
 * Only for the case where checkout could not be created, so no purchase exists
 * to attach the direction to. A backlog of these would otherwise sit at the head
 * of the queue and crowd real paid directions out of the claim scan, so they are
 * removed rather than left queued. A *paid* purchase's direction is never
 * dropped this way — it is released, not deleted.
 */
export async function dropPrompt(purchaseId: string): Promise<void> {
  await db
    .delete(promptRequests)
    .where(and(eq(promptRequests.purchaseId, purchaseId), eq(promptRequests.status, "queued")));
}

/**
 * Purchase lookup, scoped to the buyer. The package owns the table; the buyer
 * check lives here so no route can surface another user's purchase.
 */
export async function getPurchaseForUser(purchaseId: string, userId: number) {
  const purchase = await getStore().getPurchase(purchaseId);
  return purchase?.buyerId === String(userId) ? purchase : undefined;
}

/** How far into the queue to look for a direction whose buyer has credit. */
const CLAIM_SCAN_LIMIT = 25;

/**
 * Claims the next paid direction for the broadcast coordinator.
 *
 * The prompt row is claimed with a conditional update, so two coordinators
 * cannot take the same direction. The credit is only *checked* here, not spent:
 * spending happens in `completePaidDirection` after the turn succeeds, so a
 * failed turn costs the buyer nothing. The credit is checked for the prompt's
 * owner and scoped only to the channel, because the coordinator runs in a
 * server-side queue with no request session.
 */
export async function claimPaidDirection(channelId: string): Promise<PromptRequest | undefined> {
  const store = getEntitlementStore();
  // Scan a bounded batch rather than only the oldest row. The oldest queued
  // direction often belongs to a buyer who never settled — an abandoned
  // checkout, or a refunded credit — and taking only that row would let one
  // unpayable entry block every other buyer's paid direction for good, since
  // the same oldest row would be reconsidered on every turn.
  for (const candidate of await getQueuedPrompts(channelId, CLAIM_SCAN_LIMIT)) {
    if (!(await claimPrompt(candidate.id))) continue;
    const available = await store.remaining(
      String(candidate.userId),
      ENTITLEMENT.promptInfluence,
      { channelId },
    );
    // `!(x >= 1)` rather than `x < 1`: a NaN balance must read as "no credit",
    // since NaN < 1 is false and would silently hand out an unpaid direction.
    if (!(available >= 1)) {
      // Not paid (or already spent). Put it back and try the next one rather
      // than abandoning the whole queue.
      await releasePrompt(candidate.id);
      continue;
    }
    return candidate;
  }
  return undefined;
}

/**
 * Spends the credit for a direction the coordinator actually used. Returns false
 * if the credit was no longer available, in which case the caller should release
 * the direction rather than use a prompt nobody paid for.
 */
export async function completePaidDirection(
  channelId: string,
  prompt: PromptRequest,
): Promise<boolean> {
  const spent = await getEntitlementStore().consume(
    String(prompt.userId),
    ENTITLEMENT.promptInfluence,
    { channelId },
    1,
  );
  if (!spent) await releasePrompt(prompt.id);
  return spent;
}

/** Returns a direction to the queue after a failed turn. The credit is untouched. */
export async function abandonPaidDirection(promptId: number): Promise<void> {
  await releasePrompt(promptId);
}
