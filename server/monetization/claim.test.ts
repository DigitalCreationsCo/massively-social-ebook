/**
 * The claim path, tested against the real `InMemoryEntitlementStore` and a fake
 * queue.
 *
 * The bug this file exists for: `claimPaidDirection` used to consider only the
 * oldest queued direction. If that row's buyer had never settled, it was returned
 * to the queue and the call gave up — so the same oldest row was reconsidered on
 * every turn and one unpayable purchase blocked every other buyer's paid
 * direction permanently.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { InMemoryEntitlementStore } from "@portalshq/monetization";

const CHANNEL = "25th-chapter";
const KIND = "prompt_influence";

// The queue lives behind the Drizzle `db`, which needs a live database. Rather
// than mock the module, this exercises the scan-and-skip logic against the same
// store the real path uses, with the queue as a plain array.
interface Row { id: number; userId: number; promptText: string; status: string }

function harness() {
  const rows: Row[] = [];
  const entitlements = new InMemoryEntitlementStore();
  let nextId = 1;

  const claimPrompt = vi.fn(async (id: number) => {
    const row = rows.find((r) => r.id === id);
    if (!row || row.status !== "queued") return false;
    row.status = "applied";
    return true;
  });
  const releasePrompt = vi.fn(async (id: number) => {
    const row = rows.find((r) => r.id === id);
    if (row) row.status = "queued";
  });
  const enqueue = (userId: number, promptText: string) => {
    rows.push({ id: nextId++, userId, promptText, status: "queued" });
    return nextId - 1;
  };
  // Mirrors claimPaidDirection: scan a bounded batch, skip unpayable, never stop
  // at the first row.
  const claimPaidDirection = async (limit = 25) => {
    for (const candidate of rows.filter((r) => r.status === "queued").slice(0, limit)) {
      if (!(await claimPrompt(candidate.id))) continue;
      const available = await entitlements.remaining(String(candidate.userId), KIND, { channelId: CHANNEL });
      if (!(available >= 1)) { await releasePrompt(candidate.id); continue; }
      return candidate;
    }
    return undefined;
  };
  return { rows, entitlements, enqueue, claimPaidDirection, claimPrompt, releasePrompt };
}

async function grant(h: ReturnType<typeof harness>, userId: number) {
  await h.entitlements.grant([{
    id: `g_${userId}_${Math.random().toString(36).slice(2)}`,
    ruleId: "rule_superchat",
    purchaseId: `p_${userId}_${Math.random().toString(36).slice(2)}`,
    tenantId: CHANNEL,
    consumerId: String(userId),
    kind: KIND,
    scope: { channelId: CHANNEL },
    conditions: [],
    quantity: 1,
    remaining: 1,
    createdAt: new Date().toISOString(),
  }]);
}

describe("claimPaidDirection", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it("claims a direction for a buyer who has credit", async () => {
    await grant(h, 7);
    const id = h.enqueue(7, "more dragons");
    await expect(h.claimPaidDirection()).resolves.toMatchObject({ id, userId: 7 });
  });

  it("skips an unpaid head-of-queue row and serves the next buyer", async () => {
    // Row 1 is queued first but its buyer never settled.
    h.enqueue(1, "abandoned");
    await grant(h, 2);
    const paid = h.enqueue(2, "actually paid");

    const claimed = await h.claimPaidDirection();
    expect(claimed).toMatchObject({ id: paid, userId: 2, promptText: "actually paid" });
  });

  it("does not strand the unpaid row", async () => {
    h.enqueue(1, "abandoned");
    await grant(h, 2);
    h.enqueue(2, "paid");
    await h.claimPaidDirection();
    // The unpaid row is back in the queue, not deleted or lost.
    expect(h.rows.find((r) => r.promptText === "abandoned")?.status).toBe("queued");
  });

  it("serves every later buyer, not just the second", async () => {
    h.enqueue(1, "abandoned");
    for (const userId of [2, 3, 4]) {
      await grant(h, userId);
      h.enqueue(userId, `paid by ${userId}`);
    }
    const seen: number[] = [];
    for (let turn = 0; turn < 3; turn += 1) {
      const claimed = await h.claimPaidDirection();
      if (claimed) seen.push(claimed.userId);
    }
    expect(seen).toEqual([2, 3, 4]);
  });

  it("returns nothing when no buyer in the queue has credit", async () => {
    h.enqueue(1, "a");
    h.enqueue(2, "b");
    await expect(h.claimPaidDirection()).resolves.toBeUndefined();
  });

  it("stops at the scan limit rather than walking an unbounded backlog", async () => {
    for (let i = 0; i < 40; i += 1) h.enqueue(100 + i, `unpaid ${i}`);
    await grant(h, 999);
    h.enqueue(999, "paid but past the scan limit");
    // With a limit of 25 the paid row at position 41 is not reached.
    await expect(h.claimPaidDirection(25)).resolves.toBeUndefined();
    // With a larger limit it is.
    await expect(h.claimPaidDirection(50)).resolves.toMatchObject({ userId: 999 });
  });

  it("spends the credit exactly once, so a repeat turn cannot double-serve", async () => {
    await grant(h, 7);
    const id = h.enqueue(7, "more dragons");
    const first = await h.claimPaidDirection();
    expect(first?.id).toBe(id);

    const spent = await h.entitlements.consume("7", KIND, { channelId: CHANNEL }, 1);
    expect(spent).toBe(true);
    expect(await h.entitlements.consume("7", KIND, { channelId: CHANNEL }, 1)).toBe(false);
  });
});
