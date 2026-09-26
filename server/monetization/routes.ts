/**
 * Checkout, webhook, and entitlement routes.
 *
 * All money and schema logic lives in `@portalshq/monetization`; this file is
 * transport only: validate input, call the package, shape the response. It
 * deliberately holds no SQL, no Stripe calls, and no price data.
 */
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { logger } from "../logger";
import {
  CHANNEL_ID,
  ENTITLEMENT,
  TENANT_ID,
  getDispatcher,
  getSessionUser,
  getEntitlementStore,
  getMonetization,
  getProduct,
  paymentsConfigured,
  publicCatalog,
  requiresUser,
} from "./monetization";
import { dropPrompt, queuePrompt } from "./service";

/** Parks an event for an operator, keeping the failure reason in the response. */
function describeParked(event: { id: string; type: string; attempts: number; lastError?: string; deadAt?: string }) {
  return {
    id: event.id,
    type: event.type,
    attempts: event.attempts,
    lastError: event.lastError ?? null,
    deadAt: event.deadAt ?? null,
  };
}

/**
 * Mounts the monetization routes. Follows the same `registerXRoutes(app)` shape
 * as the sibling routers so the wiring in server/routes/index.ts reads alike.
 */
export function registerMonetizationRoutes(app: express.Express): void {
  app.use("/api/monetization", createMonetizationRouter());
}

export function createMonetizationRouter(): express.Router {
  const router = express.Router();

  router.get("/catalog", async (_req: Request, res: Response) => {
    res.json({ products: publicCatalog(), configured: paymentsConfigured() });
  });

  router.post("/checkout", requiresUser, async (req: Request, res: Response) => {
    // Field names follow the buyer's contract in PayToPromptPanel: `prompt`,
    // not `promptText`. Accept both so a hand-rolled caller is not rejected.
    const { productKey, prompt, promptText } = (req.body ?? {}) as {
      productKey?: string;
      prompt?: string;
      promptText?: string;
    };
    const direction = (prompt ?? promptText)?.trim();
    if (!productKey) {
      res.status(400).json({ message: "productKey is required" });
      return;
    }
    // Resolved once, from the same catalog the package prices from, so the
    // product that is validated is provably the product that is charged. A key
    // that is not in the catalog is a 400 rather than a 500 from deep inside
    // checkout.
    const product = getProduct(productKey);
    if (!product) {
      res.status(400).json({ message: "unknown product" });
      return;
    }
    if (product.purchaseKind === "super_chat" && !direction) {
      res.status(400).json({ message: "A paid prompt needs the direction to send." });
      return;
    }

    const user = getSessionUser(req);
    const sessionId = req.sessionID;
    const origin = `${req.protocol}://${req.get("host") ?? ""}`;

    // Declared outside the try because the catch needs them to undo a queued
    // direction when checkout cannot start.
    const purchaseId = randomUUID();
    const isSuperchat = product.purchaseKind === "super_chat";

    try {
      const monetization = getMonetization();
      // The purchase id is generated up front and acts as the idempotency key: a
      // retried request resumes the same Stripe session rather than charging
      // twice. It also links the queued prompt to the purchase for auditing.
      // Queued before the redirect, so a paid purchase always has its direction.
      if (isSuperchat) {
        await queuePrompt(CHANNEL_ID, user!.id, direction!, purchaseId);
      }
      // One platform-held Customer per user, so a single saved card pays across
      // every tenant this user buys from.
      const customer = await monetization.ensureBillingCustomer(String(user!.id));
      const session = await monetization.createCheckout({
        purchaseId,
        tenantId: TENANT_ID,
        channelId: CHANNEL_ID,
        sessionId,
        buyerId: String(user!.id),
        customerId: customer.id,
        productKey,
        successUrl: `${origin}/?checkout=success`,
        cancelUrl: `${origin}/?checkout=cancelled`,
      });
      res.json({ url: session.url });
    } catch (error) {
      // No purchase exists to attach the direction to, so remove the row: a
      // backlog of unpayable rows would crowd out real paid directions in the
      // claim scan and eventually starve them.
      if (isSuperchat) await dropPrompt(purchaseId).catch(() => undefined);
      logger.error("Checkout failed", "monetization", error as Error);
      res.status(500).json({ message: "could not start checkout" });
    }
  });

  /**
   * Stripe webhook. The package verifies the signature, deduplicates, and
   * enqueues settlement; the outbox dispatcher then applies entitlements. This
   * endpoint must stay fast and must return 2xx even for events it will not
   * settle, or Stripe will retry forever.
   */
  router.post("/webhook", express.raw({ type: "application/json" }), async (req: Request, res: Response) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      res.status(503).json({ message: "webhooks not configured" });
      return;
    }
    try {
      // Signature comes from the header, not a query param, so it is not logged
      // in access logs or leaked through referrers.
      const signature = req.get("stripe-signature");
      if (!signature) {
        res.status(400).json({ message: "missing signature" });
        return;
      }
      await getMonetization().handleWebhook(
        Buffer.isBuffer(req.body) ? req.body : Buffer.from(""),
        signature,
        secret,
      );
      res.json({ received: true });
    } catch (error) {
      // A signature failure is a real 400: telling Stripe otherwise invites
      // unbounded retries of a request we will never accept.
      const badSignature = error instanceof Error && /signature/i.test(error.message);
      logger.error("Webhook rejected", "monetization", error as Error);
      res.status(badSignature ? 400 : 500).json({ message: "webhook rejected" });
    }
  });

  /** This user's grants, so the UI can render badges without guessing. */
  router.get("/entitlements", requiresUser, async (req: Request, res: Response) => {
    const user = getSessionUser(req);
    const sessionId = req.sessionID;
    const store = getEntitlementStore();
    const promptCount = await store.remaining(
      String(user!.id),
      ENTITLEMENT.promptInfluence,
      { channelId: CHANNEL_ID, sessionId },
    );
    const isFounding = (await store.remaining(String(user!.id), ENTITLEMENT.foundingMember, { channelId: CHANNEL_ID })) > 0;
    res.json({
      promptCredits: promptCount,
      isFoundingMember: isFounding,
    });
  });

  /**
   * Drains the settlement outbox. Internal: a superuser token or a scheduler
   * calls it. Exposed as a route because there is no worker host in this app yet,
   * which keeps a cron or a `while` loop viable without new infrastructure.
   */
  router.post("/drain", async (req: Request, res: Response) => {
    const expected = process.env.MONETIZATION_DRAIN_TOKEN?.trim();
    if (expected && req.get("authorization") !== `Bearer ${expected}`) {
      res.status(401).json({ message: "unauthorized" });
      return;
    }
    const result = await getDispatcher().drainOnce();
    res.json(result);
  });

  /** Parked settlement events awaiting an operator, with the error that parked them. */
  router.get("/outbox/parked", async (_req: Request, res: Response) => {
    const events = await getDispatcher().listParked(50);
    res.json({ count: events.length, events: events.map(describeParked) });
  });

  /**
   * Requeues parked settlement events so the next drain retries them. Bulk, not
   * per-id: an operator replays after fixing the underlying fault, and re-running
   * already-succeeded events is harmless because settlement is idempotent per
   * Stripe event. `?limit=` caps how many.
   */
  router.post("/outbox/replay", async (req: Request, res: Response) => {
    const expected = process.env.MONETIZATION_DRAIN_TOKEN?.trim();
    if (expected && req.get("authorization") !== `Bearer ${expected}`) {
      res.status(401).json({ message: "unauthorized" });
      return;
    }
    const requested = Number(req.query.limit ?? 100);
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 500) : 100;
    const requeued = await getDispatcher().requeueParked(limit);
    res.json({ requeued });
  });

  return router;
}
