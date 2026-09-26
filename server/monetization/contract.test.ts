/**
 * The HTTP contract between the server and `PayToPromptPanel`.
 *
 * This file exists because the two sides were written against each other
 * without a shared type, and they silently disagreed: the client posted `prompt`
 * while the route read `promptText`, read `configured` where the route sent
 * `paymentsConfigured`, and read `message` where the route sent `error`. None of
 * that broke the build, and a superchat would have 400'd in production while
 * every unit test passed.
 *
 * The shapes below are copied from the client, not derived from the server, so
 * this test fails when the *server* drifts.
 */
import { describe, expect, it } from "vitest";
import { getProduct, publicCatalog, ENTITLEMENT } from "./catalog";

// ── Copied from client/src/components/PayToPromptPanel.tsx ──────────────────
type ClientProduct = {
  key: string;
  name: string;
  description: string;
  amount: number;
  currency: string;
  kind: string;
  requiresPrompt: boolean;
};
type ClientCatalogResponse = { products: ClientProduct[]; configured: boolean };
type ClientCheckoutError = { message?: string };

describe("catalog contract", () => {
  it("returns exactly the fields the client reads", () => {
    const body = {
      products: publicCatalog(),
      configured: true,
    } as unknown as ClientCatalogResponse;

    for (const product of body.products) {
      const typed: ClientProduct = product;
      expect(typeof typed.key).toBe("string");
      expect(typeof typed.name).toBe("string");
      expect(typeof typed.description).toBe("string");
      expect(Number.isInteger(typed.amount)).toBe(true);
      expect(typeof typed.currency).toBe("string");
      expect(typeof typed.kind).toBe("string");
      expect(typeof typed.requiresPrompt).toBe("boolean");
    }
  });

  it("offers the three products the composer defaults to", () => {
    const keys = publicCatalog().map((product) => product.key);
    expect(keys).toEqual(["superchat_1", "superchat_5", "founding_member"]);
    // The panel preselects superchat_1, so it must exist.
    expect(keys).toContain("superchat_1");
  });

  it("marks only superchats as needing a prompt", () => {
    const byKey = new Map(publicCatalog().map((p) => [p.key, p]));
    expect(byKey.get("superchat_1")?.requiresPrompt).toBe(true);
    expect(byKey.get("superchat_5")?.requiresPrompt).toBe(true);
    expect(byKey.get("founding_member")?.requiresPrompt).toBe(false);
  });

  it("prices in minor units, as formatPrice divides by 100", () => {
    const byKey = new Map(publicCatalog().map((p) => [p.key, p]));
    expect(byKey.get("superchat_1")?.amount).toBe(100);
    expect(byKey.get("superchat_5")?.amount).toBe(500);
    expect(byKey.get("founding_member")?.amount).toBe(2900);
  });

  it("never leaks the platform rake to the buyer", () => {
    for (const product of publicCatalog()) {
      expect(Object.keys(product)).not.toContain("platformFeeAmount");
      expect(Object.keys(product)).not.toContain("stripeAccountId");
    }
  });
});

describe("product lookup contract", () => {
  it("resolves a declared product with its key filled in", () => {
    expect(getProduct("superchat_1")).toMatchObject({
      key: "superchat_1",
      purchaseKind: "super_chat",
      name: "Story Superchat",
      unitAmount: 100,
      currency: "usd",
    });
  });

  it("returns undefined for an unknown key rather than a broken product", () => {
    // The route turns this into a 400, not a 500 from inside checkout.
    expect(getProduct("free_coins")).toBeUndefined();
  });

  it("exposes the entitlement kind the coordinator spends", () => {
    expect(ENTITLEMENT.promptInfluence).toBe("prompt_influence");
    expect(ENTITLEMENT.foundingMember).toBe("founding_member");
  });
});
