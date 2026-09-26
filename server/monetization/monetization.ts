/**
 * Wiring for `@portalshq/monetization`.
 *
 * The single place in this app that reads monetization configuration and
 * constructs the package. Nothing else should read `STRIPE_SECRET_KEY` or touch
 * the billing tables: the package owns the schema, and the catalog below is
 * server-authoritative so no price ever reaches a browser.
 *
 * Identity mapping:
 *   tenant   = the publication. One Connect account, receives all money.
 *   channel  = the app instance. `DEFAULT_CHANNEL_ID`.
 *   consumer = this app's user, carried as a string.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
  Monetization,
  MonetizationDispatcher,
  PostgresBillingStore,
  PostgresEntitlementStore,
  createStripePlatformClient,
  SELF_BIND,
  type BillingCatalog,
  type Product,
  type EntitlementStore,
  type PurchaseKind,
} from "@portalshq/monetization";
import { MeteringClient, MeteringEvents } from "@portalshq/platform-billing";
import { pool } from "../db";
import { logger } from "../logger";
import { CHANNEL_ID, ENTITLEMENT, TENANT_ID, catalog } from "./catalog";

export {
  CHANNEL_ID,
  ENTITLEMENT,
  TENANT_ID,
  getProduct,
  paymentsConfigured,
  publicCatalog,
} from "./catalog";


const ids = { next: () => randomUUID() };

function requireStripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return key;
}

let store: PostgresBillingStore | undefined;
let entitlements: PostgresEntitlementStore | undefined;
let monetization: Monetization | undefined;
let dispatcher: MonetizationDispatcher | undefined;

/**
 * Requires a signed-in user. The app stores the user id on the session, so this
 * is the one place that assumption is asserted for the monetization routes.
 */
export const requiresUser = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.session.userId) {
    res.status(401).json({ error: "sign in required" });
    return;
  }
  next();
};

/** The signed-in user's id, narrowed by `requiresUser`. */
export const getSessionUser = (req: Request): { id: number } => ({ id: req.session.userId as number });

/** The package's store, for app-side lookups that must be scoped to a user. */
export function getStore(): PostgresBillingStore {
  store ??= new PostgresBillingStore(pool as unknown as pg.Pool);
  return store;
}

export function getEntitlementStore(): EntitlementStore {
  entitlements ??= new PostgresEntitlementStore(pool as unknown as pg.Pool);
  return entitlements;
}

export function getMonetization(): Monetization {
  monetization ??= new Monetization({
    stripe: createStripePlatformClient(requireStripeKey()),
    store: getStore(),
    catalog,
    ids,
    // The platform holds the negative balance, so a dispute can be recovered
    // from the tenant. Reversing a transfer takes the funds back; a merchant
    // dispute that is not our fault should still be settled, so this is policy,
    // not mechanics, and it is logged either way.
    reverseTransferForDispute: (purchase, dispute) => {
      logger.warn("Dispute: reversing Connect transfer", "monetization", undefined, {
        purchaseId: purchase.id, disputeId: dispute.id, amount: dispute.amount,
      });
      return true;
    },
  });
  return monetization;
}

/**
 * Outbox delivery with entitlement handling already wired. Constructing this is
 * all the wiring there is; `drainOnce` is what must be scheduled.
 */
export function getDispatcher(): MonetizationDispatcher {
  dispatcher ??= new MonetizationDispatcher({
    store: getStore(),
    entitlements: getEntitlementStore(),
    ids,
    // Below the package default: a settle that cannot be evaluated should be
    // retried and then parked, not retried for hours.
    maxAttempts: 8,
    logger: (message, meta) => logger.warn(message, "monetization", undefined, meta as Record<string, unknown>),
    onEvent: (event) => {
      if (event.type === "billing.purchase_settled") {
        // Fire-and-forget by design: metering must never block settlement.
        void metering.emit(
          MeteringEvents.marketplaceTransaction({
            subject: `tenant:${TENANT_ID}`,
            capabilityId: String(event.payload.kind),
            providerId: TENANT_ID,
            grossAmountCents: Number(event.payload.amount ?? 0),
            currency: String(event.payload.currency ?? "usd"),
          }),
        );
      }
    },
  });
  return dispatcher;
}

const metering = new MeteringClient();

/**
 * Idempotently installs this app's entitlement rules.
 *
 * Rules are tenant-owned data, not code, so they are seeded rather than shipped
 * in a migration — a tenant can edit scope and quantity without a deploy.
 * Scopes encode the lifetime: a superchat is scoped to one session because its
 * effect is one story turn, while a founding badge is scoped to the channel and
 * is never consumed.
 */
export async function seedEntitlementRules(): Promise<void> {
  const store = getEntitlementStore();
  const now = new Date().toISOString();
  const rules = [
    {
      id: `${TENANT_ID}:superchat`,
      kind: ENTITLEMENT.promptInfluence,
      scope: { channelId: CHANNEL_ID, sessionId: "$session" },
      conditions: [{ fact: "purchaseKind" as const, equals: "super_chat" as PurchaseKind }],
      quantity: 1,
    },
    {
      id: `${TENANT_ID}:founding`,
      kind: ENTITLEMENT.foundingMember,
      scope: { channelId: CHANNEL_ID },
      conditions: [{ fact: "productKey" as const, equals: "founding_member" }],
      quantity: 1,
    },
  ];
  for (const rule of rules) {
    await store.saveRule({ ...rule, tenantId: TENANT_ID, createdAt: now } as never);
  }
  logger.info("Entitlement rules seeded", "monetization", { rules: rules.map((r) => r.id) });
}


export { CHANNEL_ID as monetizationChannelId };
