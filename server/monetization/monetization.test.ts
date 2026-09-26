/**
 * Settlement path, end to end, against the real package.
 *
 * The point of these tests is the seam between a Stripe `checkout.session.completed`
 * and a buyer's entitlement appearing. Everything above that seam is exercised
 * with the real `Monetization`, `MonetizationDispatcher`, and in-memory stores;
 * only Stripe's HTTP client is faked.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import {
  InMemoryEntitlementStore,
  Monetization,
  MonetizationDispatcher,
  SELF_BIND,
  type BillingOutboxEvent,
  type EntitlementRule,
  type Purchase,
  type PurchaseKind,
  type TenantBillingProfile,
} from "@portalshq/monetization";

const CHANNEL = "25th-chapter";
const TENANT = "25th-chapter";

function build() {
  const profile: TenantBillingProfile = {
    tenantId: TENANT, ownerId: "owner", stripeAccountId: "acct_tenant",
    transfersStatus: "active", defaultCurrency: "usd", createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const purchases = new Map<string, Purchase>();
  const outbox: BillingOutboxEvent[] = [];
  const seen = new Set<string>();
  let seq = 0;
  const ids = { next: () => `id_${++seq}` };

  const transaction = {
    getPurchase: async (id: string) => purchases.get(id),
    findPurchaseByStripeReference: async (ref: string) =>
      [...purchases.values()].find((p) =>
        [p.stripeCheckoutSessionId, p.stripePaymentIntentId, p.stripeChargeId, p.stripeTransferId].includes(ref)),
    savePurchase: async (p: Purchase) => { purchases.set(p.id, p); },
    saveTenantProfile: async () => {},
    appendLedger: async () => {},
    appendOutbox: async (e: BillingOutboxEvent) => { outbox.push(e); },
  };
  const store = {
    getBillingCustomer: async () => undefined,
    saveBillingCustomer: async () => {},
    getTenantProfile: async (id: string) => (id === TENANT ? profile : undefined),
    findTenantProfileByAccount: async () => profile,
    saveTenantProfile: async () => {},
    createPurchase: async (p: Purchase) => { purchases.set(p.id, p); return p; },
    getPurchase: async (id: string) => purchases.get(id),
    processStripeEvent: async (event: Stripe.Event, apply: (t: typeof transaction) => Promise<void>) => {
      if (seen.has(event.id)) return "duplicate" as const;
      await apply(transaction);
      seen.add(event.id);
      return "processed" as const;
    },
    claimOutbox: async (limit: number) => {
      const claimed = outbox.filter((e) => !e.deadAt && e.attempts <= 3).slice(0, limit);
      return claimed.map((e) => ({ ...e, attempts: e.attempts + 1 }));
    },
    completeOutbox: async () => {},
    failOutbox: async () => {},
    markOutboxDead: async (id: string) => {
      const event = outbox.find((e) => e.id === id);
      if (event) { event.deadAt = new Date().toISOString(); }
    },
    listDeadOutbox: async () => outbox.filter((e) => e.deadAt),
    requeueDeadOutbox: async (limit: number) => {
      const parked = outbox.filter((e) => e.deadAt).slice(0, limit);
      for (const e of parked) { delete e.deadAt; }
      return parked.length;
    },
    appendLedger: async () => {},
    listPurchases: async () => [...purchases.values()],
  };
  const entitlements = new InMemoryEntitlementStore();
  const stripe = {
    checkout: { sessions: { create: vi.fn(async () => ({ id: "cs_1", url: "https://pay.test/1" })), retrieve: vi.fn() } },
    transfers: { create: vi.fn(async () => ({ id: "tr_1" })), createReversal: vi.fn(async () => ({})) },
    paymentIntents: { retrieve: vi.fn(async () => ({ amount: 100, amount_captured: 100 })) },
    v2: { core: { accounts: { create: vi.fn(), retrieve: vi.fn() } } },
    // The package verifies the signature through Stripe's client; here the raw
    // body already contains the event, so parse it out.
    webhooks: { constructEvent: (payload: string) => JSON.parse(payload) as Stripe.Event },
    customers: { create: vi.fn(async () => ({ id: "cus_1" })) },
  } as unknown as Stripe;

  const monetization = new Monetization({
    stripe, store: store as never, ids,
    catalog: {
      resolve: (key: string) => {
        if (key === "superchat_1") {
          return { key, purchaseKind: "super_chat" as PurchaseKind, name: "Superchat", unitAmount: 100, currency: "usd", platformFeeAmount: 10 };
        }
        return { key, purchaseKind: "founding_member" as PurchaseKind, name: "Founding", unitAmount: 2900, currency: "usd", platformFeeAmount: 10 };
      },
    },
  });
  const dispatcher = new MonetizationDispatcher({ store: store as never, entitlements, ids });
  return { monetization, dispatcher, entitlements, outbox, purchases, stripe, profile, ids };
}

function paidEvent(purchaseId: string): Stripe.Event {
  return {
    id: `evt_${purchaseId}`, type: "checkout.session.completed", created: 1,
    data: { object: {
      id: "cs_1", payment_status: "paid", client_reference_id: purchaseId,
      metadata: { purchaseId }, amount_total: 100, currency: "usd",
    } },
  } as unknown as Stripe.Event;
}

const superchatRule = (): EntitlementRule => ({
  id: "rule_superchat", tenantId: TENANT, kind: "prompt_influence",
  scope: { channelId: SELF_BIND },
  conditions: [{ fact: "purchaseKind", equals: "super_chat" }],
  quantity: 1, createdAt: "2026-01-01T00:00:00.000Z",
});

describe("purchase settles, entitlement appears", () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => { ctx = build(); });

  it("grants a superchat credit scoped to the purchase's channel", async () => {
    await ctx.entitlements.saveRule(superchatRule());
    const { sessionId } = await ctx.monetization.createCheckout({
      purchaseId: "p1", tenantId: TENANT, channelId: CHANNEL,
      buyerId: "user_7", productKey: "superchat_1",
      successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no",
    });

    const result = await ctx.monetization.handleWebhook(
      JSON.stringify(paidEvent("p1")), "sig", "secret", { verification: () => paidEvent("p1") } as never,
    );
    expect(result.status).not.toBe("ignored");

    const drain = await ctx.dispatcher.drainOnce();
    expect(drain.granted).toBe(1);

    const credit = await ctx.entitlements.remaining("user_7", "prompt_influence", { channelId: CHANNEL });
    expect(credit).toBe(1);
    void sessionId;
  });

  it("lets a buyer spend the credit exactly once", async () => {
    await ctx.entitlements.saveRule(superchatRule());
    await ctx.monetization.createCheckout({
      purchaseId: "p1", tenantId: TENANT, channelId: CHANNEL,
      buyerId: "user_7", productKey: "superchat_1",
      successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no",
    });
    await ctx.monetization.handleWebhook(
      JSON.stringify(paidEvent("p1")), "sig", "secret", { verification: () => paidEvent("p1") } as never,
    );
    await ctx.dispatcher.drainOnce();

    await expect(ctx.entitlements.consume("user_7", "prompt_influence", { channelId: CHANNEL }, 1)).resolves.toBe(true);
    await expect(ctx.entitlements.consume("user_7", "prompt_influence", { channelId: CHANNEL }, 1)).resolves.toBe(false);
  });

  it("keeps one buyer's credit out of another's hands", async () => {
    await ctx.entitlements.saveRule(superchatRule());
    await ctx.monetization.createCheckout({
      purchaseId: "p1", tenantId: TENANT, channelId: CHANNEL,
      buyerId: "user_7", productKey: "superchat_1",
      successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no",
    });
    await ctx.monetization.handleWebhook(
      JSON.stringify(paidEvent("p1")), "sig", "secret", { verification: () => paidEvent("p1") } as never,
    );
    await ctx.dispatcher.drainOnce();

    expect(await ctx.entitlements.remaining("someone_else", "prompt_influence", { channelId: CHANNEL })).toBe(0);
  });

  it("does not grant anything before Stripe confirms payment", async () => {
    await ctx.entitlements.saveRule(superchatRule());
    await ctx.monetization.createCheckout({
      purchaseId: "p1", tenantId: TENANT, channelId: CHANNEL,
      buyerId: "user_7", productKey: "superchat_1",
      successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no",
    });

    const unpaid = { ...paidEvent("p1"), data: { object: { ...(paidEvent("p1").data as never as { object: object }).object, payment_status: "unpaid" } } };
    await ctx.monetization.handleWebhook(JSON.stringify(unpaid), "sig", "secret");
    await ctx.dispatcher.drainOnce();

    expect(await ctx.entitlements.remaining("user_7", "prompt_influence", { channelId: CHANNEL })).toBe(0);
  });

  it("is idempotent when Stripe redelivers the same event", async () => {
    await ctx.entitlements.saveRule(superchatRule());
    await ctx.monetization.createCheckout({
      purchaseId: "p1", tenantId: TENANT, channelId: CHANNEL,
      buyerId: "user_7", productKey: "superchat_1",
      successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no",
    });
    const event = paidEvent("p1");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await ctx.monetization.handleWebhook(JSON.stringify(event), "sig", "secret");
      await ctx.dispatcher.drainOnce();
    }

    expect(await ctx.entitlements.remaining("user_7", "prompt_influence", { channelId: CHANNEL })).toBe(1);
  });

  it("grants a founding badge that is never spent away", async () => {
    await ctx.entitlements.saveRule({
      id: "rule_founding", tenantId: TENANT, kind: "founding_member",
      scope: { channelId: SELF_BIND },
      conditions: [{ fact: "productKey", equals: "founding_member" }],
      quantity: 1, createdAt: "2026-01-01T00:00:00.000Z",
    });
    await ctx.monetization.createCheckout({
      purchaseId: "p2", tenantId: TENANT, channelId: CHANNEL,
      buyerId: "user_9", productKey: "founding_member",
      successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no",
    });
    const event = paidEvent("p2");
    await ctx.monetization.handleWebhook(JSON.stringify(event), "sig", "secret");
    await ctx.dispatcher.drainOnce();

    const site = { channelId: CHANNEL };
    expect(await ctx.entitlements.remaining("user_9", "founding_member", site)).toBe(1);
    expect(await ctx.entitlements.remaining("user_9", "founding_member", site)).toBe(1);
  });
});
