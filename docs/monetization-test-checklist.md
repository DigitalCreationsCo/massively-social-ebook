# Monetization test checklist

Everything needed to verify the superchat / founding-member flow for real. Work
top to bottom: each step depends on the one above it. Steps 1–6 need no money and
no Stripe account; 7 onward uses Stripe test mode.

Owner: ____________  Date started: ____________  Stripe test account: ____________

## 0. What you are verifying

One sentence: a buyer pays on Stripe, and only after Stripe confirms it does the
app grant that buyer one paid story direction — once, scoped to them, and never
twice for one payment.

Three claims, three checks:

| Claim | Verified by |
| --- | --- |
| No entitlement before payment | Step 7, "unpaid session grants nothing" |
| Exactly one entitlement per payment | Step 8 + Step 9 |
| One buyer's credit is not another's | Step 10 |

## 1. Install the local packages (no symlinks)

```bash
npm ci
```

The three packages are ordinary npm dependencies (`^0.2.0`, `^0.0.5`,
`^0.0.5`), so `npm ci` is all there is — no local build step and no symlinks.
They 404 until the Release Engine workflow in `portalshq/portals-cloud` has
published them. Confirm they resolved from the registry rather than a local path:

```bash
npm ls @portalshq/monetization @portalshq/policy @portalshq/platform-billing
find node_modules/@portalshq -maxdepth 1 -type l   # must print nothing
```

- [ ] `npm ls` shows no `file:` specifiers and no `invalid` markers
- [ ] No symlinks under `node_modules/@portalshq`
- [ ] `node -e "console.log(require.resolve('@portalshq/monetization'))"` points inside `node_modules`

## 2. Database

The package owns its schema. Apply the migration that installs it, then let
Drizzle create the app's own `prompt_requests`.

```bash
npm run db:migrate      # applies migrations/*_install_portalshq_monetization.sql
npm run db:generate     # only if shared/schema.ts changed
npm run db:migrate
```

The migration creates `monetization_billing_customers`, `_tenant_profiles`,
`_purchases`, `_stripe_events`, `_ledger`, `_outbox`, `_entitlement_rules`, and
`_entitlements`. Confirm:

```sql
\d monetization_outbox
\d monetization_entitlements
\d monetization_billing_customers
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'monetization_outbox' AND column_name IN ('attempts','last_error','dead_at');
```

- [ ] All eight `monetization_*` tables exist
- [ ] `monetization_outbox` has `attempts`, `last_error`, `dead_at`
- [ ] `prompt_requests` exists and has no foreign key to a `monetization_*` table

## 3. Stripe keys (test mode)

Use a **restricted** key on the platform account, not `sk_`. The platform is
merchant of record, so it needs customer + charge write and Connect read.

- [ ] `STRIPE_SECRET_KEY` starts with `rk_` and is a test key
- [ ] Key is scoped to the endpoints the package uses (customers, checkout
      sessions, payment intents, transfers, v2 accounts) — not `all`
- [ ] Never a live key in a dev or CI environment

## 4. Webhook

```bash
stripe listen --forward-to localhost:5173/api/monetization/webhook
```

Copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`. Subscribe to:

- `checkout.session.completed`
- `charge.succeeded`
- `charge.refunded`
- `charge.dispute.created`
- `account.updated`

- [ ] `STRIPE_WEBHOOK_SECRET` set
- [ ] `/api/monetization/webhook` returns 200 (not 503)
- [ ] A request with a bad signature returns **400**, not 200 or 500 — otherwise
      Stripe will retry a request you will never accept forever

## 5. Config

From `.env.example`: `MONETIZATION_TENANT_ID`, `MONETIZATION_FEE_CENTS`,
`MONETIZATION_DRAIN_INTERVAL_MS`, `MONETIZATION_DRAIN_TOKEN`.

- [ ] `MONETIZATION_TENANT_ID` matches the channel this app runs
- [ ] `MONETIZATION_DRAIN_TOKEN` is set to a random value
- [ ] A pooler URL in `DATABASE_URL` is fine — the outbox uses `SKIP LOCKED`

## 6. Seed the tenant's Connect account and rules

On first boot, for each tenant: create a Connect account (Accounts v2), request
`stripe_transfers` on `configuration.recipient.capabilities`, and complete
Express onboarding. Then seed entitlement rules.

- [ ] Connect account created; `transfers_status` is `active`, not `pending`
- [ ] Entitlement rules exist for `prompt_influence` (a superchat) and
      `founding_member`, both scoped with `SELF_BIND` on channel
- [ ] Rules are readable: `GET /api/monetization/catalog` returns 3 products and
      `paymentsConfigured: true`

## 7. Automated settle path (no money)

```bash
npx vitest run server/monetization
```

Six tests, no network:

- [ ] "grants a superchat credit scoped to the purchase's channel"
- [ ] "lets a buyer spend the credit exactly once"
- [ ] "keeps one buyer's credit out of another's hands"
- [ ] "does not grant anything before Stripe confirms payment"
- [ ] "is idempotent when Stripe redelivers the same event"
- [ ] "grants a founding badge that is never spent away"

## 8. Manual: buy with a test card

- [ ] Sign in. `GET /api/monetization/entitlements` shows `promptCredits: 0`
- [ ] `POST /api/monetization/checkout` with `superchat_1` and a prompt returns a
      `stripe.com` URL
- [ ] Pay with `4242 4242 4242 4242`
- [ ] The webhook fires and the drain grants within ~5s
- [ ] `GET /api/monetization/entitlements` now shows `promptCredits: 1`
- [ ] A `prompt_requests` row exists with your prompt text, linked by `purchaseId`
- [ ] The next story turn honours the direction, and the message is labelled as
      paid audience input

## 9. Manual: no double charge, no double grant

- [ ] Resend the same `checkout.session.completed` (`stripe events resend`) —
      `promptCredits` stays `1`
- [ ] Retry checkout with the same `purchaseId` — one charge, same session
- [ ] Spend the credit, then confirm a second spend returns nothing (no
      entitlements, prompt returns to the queue rather than disappearing)

## 10. Manual: isolation

- [ ] User B's `promptCredits` is 0 while User A's is 1
- [ ] A founding badge persists across many turns — it is never consumed

## 11. Dead letter and replay

Force a failure by pointing a rule at a missing table, or by temporarily
throwing in `onEvent`.

- [ ] After the attempt budget, the event moves to the outbox with `dead_at` set
      — it is **retained, not deleted**
- [ ] `GET /api/monetization/outbox/parked` lists it with `lastError`
- [ ] Fix the cause, then `POST /api/monetization/outbox/replay` with the drain
      token — the event is requeued and settles
- [ ] `POST` without the token returns 401

## 12. Refund and dispute

- [ ] Refunding revokes the entitlements that purchase created
- [ ] `charge.dispute.created` attempts a Connect transfer reversal with a stable
      idempotency key, and logs the dispute either way — the platform carries
      dispute liability, so this is policy to confirm, not mechanics

## 13. Observability

- [ ] `GET /api/monetization/outbox/parked` is empty in normal operation
- [ ] `lastDrainAt()` advances; a stalled drain is visible
- [ ] Metering events are fire-and-forget — a metering outage must not block
      settlement

## Sign-off

- [ ] Steps 1–7 pass in CI with no Stripe secrets
- [ ] Steps 8–10 pass manually in test mode
- [ ] `MONETIZATION_DRAIN_TOKEN` is set on the real deployment before enabling
      live keys

Known gaps: policy lineage (royalty splits) has no producer yet, so tenant
payouts are not exercised. Metering has no tests. `@portalshq/policy` and
`@portalshq/platform-billing` have no tests of their own.
