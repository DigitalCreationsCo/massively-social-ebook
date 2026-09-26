/**
 * The tenant's product list and the identity this app bills under.
 *
 * Deliberately free of any database import. The server-authoritative price list
 * is pure data, so a test or a CLI that only needs to read prices should not have
 * to open a connection pool. Everything touching Postgres lives in
 * `monetization.ts`, which builds on this.
 */
import {
  SELF_BIND,
  type BillingCatalog,
  type Product,
  type PurchaseKind,
} from "@portalshq/monetization";
import { DEFAULT_CHANNEL_ID } from "@shared/channel-id";

/** The publication. One tenant, however many channels it launches. */
export const TENANT_ID = process.env.MONETIZATION_TENANT_ID?.trim() || "25th-chapter";
export const CHANNEL_ID = DEFAULT_CHANNEL_ID;

/**
 * Server-authoritative pricing. `platformFeeAmount` is the platform's rake and
 * is never sent to the client — the catalog endpoint returns a projection.
 */
const PRODUCTS: Record<string, Omit<Product, "key">> = {
  superchat_1: {
    purchaseKind: "super_chat",
    name: "Story Superchat",
    description: "Put one audience direction into the next story window.",
    unitAmount: 100,
    currency: "usd",
    platformFeeAmount: Number(process.env.MONETIZATION_FEE_CENTS ?? 10),
  },
  superchat_5: {
    purchaseKind: "super_chat",
    name: "Director's Cue",
    description: "A priority story direction with a highlighted room message.",
    unitAmount: 500,
    currency: "usd",
    platformFeeAmount: Number(process.env.MONETIZATION_FEE_CENTS ?? 10),
  },
  founding_member: {
    purchaseKind: "founding_member",
    name: "Founding Member",
    description: "A permanent founding badge and early access to new live experiences.",
    unitAmount: 2900,
    currency: "usd",
    platformFeeAmount: Number(process.env.MONETIZATION_FEE_CENTS ?? 10),
  },
};


/** Entitlement kinds this app grants. See seedEntitlementRules. */
export const ENTITLEMENT = {
  /** One honoured audience direction, spent by the broadcast coordinator. */
  promptInfluence: "prompt_influence",
  /** A standing founding badge. Never consumed, so it persists. */
  foundingMember: "founding_member",
} as const;

export const catalog: BillingCatalog = {
  resolve(productKey: string): Product {
    const product = PRODUCTS[productKey];
    if (!product) throw new TypeError(`unknown product: ${productKey}`);
    return { key: productKey, ...product };
  },
};

/** True when payments are configured. The catalog still renders without it. */
export function paymentsConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_WEBHOOK_SECRET?.trim());
}

/**
 * Catalog projection safe to return to a browser: no fee, no destination
 * account, no platform internals. Field names are the buyer's contract with
 * `client/src/components/PayToPromptPanel.tsx` — `amount` in minor units, and
 * `configured` rather than a name that leaks how it is configured.
 */
export function publicCatalog() {
  return Object.entries(PRODUCTS).map(([key, product]) => ({
    key,
    name: product.name,
    description: product.description ?? "",
    amount: product.unitAmount,
    currency: product.currency,
    kind: product.purchaseKind,
    requiresPrompt: product.purchaseKind === "super_chat",
  }));
}

/** A declared product, or undefined. Prices here are never sent to a client. */
export function getProduct(productKey: string): Product | undefined {
  const product = PRODUCTS[productKey];
  return product ? { key: productKey, ...product } : undefined;
}
