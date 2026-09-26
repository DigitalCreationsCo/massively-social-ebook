# Monetization

Three server-priced products:

- `superchat_1` — $1 Story Superchat
- `superchat_5` — $5 Director's Cue
- `founding_member` — $29 one-time Founding Member

## Where the logic lives

**All of it is in `@portalshq/monetization`.** This app supplies configuration
and its own domain data; it never calls Stripe, never writes a payment table, and
never computes a price from client input.

| Concern | Owner |
| --- | --- |
| Checkout, webhooks, settlement, disputes | `@portalshq/monetization` |
| Purchases, entitlements, ledger, outbox tables | `@portalshq/monetization` |
| Which products exist and what they cost | `server/monetization/monetization.ts` |
| The creative direction a superchat bought | `server/monetization/service.ts` |
| When a paid direction is honoured | `server/broadcast/coordinator.ts` |
| HTTP transport | `server/monetization/routes.ts` |

Schema ships with the package and is applied by
`migrations/*_install_portalshq_monetization.sql`, which is a verbatim copy of the
package's `sql/001_monetization.sql`.

## Identity

| Platform concept | In this app |
| --- | --- |
| tenant (builds/launches, owns a Connect account) | the publication, `MONETIZATION_TENANT_ID` |
| channel (attribution) | `DEFAULT_CHANNEL_ID` |
| consumer (the paying end user) | this app's user, as a string |

The platform holds the end user's Stripe `Customer`, so one saved card pays for
purchases across every tenant this person buys from. The platform creates the
charge and the tenant receives a Connect transfer.

## The settle path

```
checkout.session.completed
  → package verifies signature, dedupes on Stripe event id
  → writes a settlement outbox event          (never lost: outbox, not fire-and-forget)
  → MonetizationDispatcher.drainOnce()         (every MONETIZATION_DRAIN_INTERVAL_MS)
      → marks the purchase settled
      → applies entitlement rules
      → grants prompt_influence to the buyer
```

Entitlements are balances, not booleans. A superchat grants **one**
`prompt_influence` in the channel where it was bought; the coordinator spends
exactly one when it honours that direction. A founding member grants a badge that
is never spent, so it persists.

Rules are tenant-owned data, not code — seeded at boot by
`seedEntitlementRules()`, editable without a deploy. Their scope uses
`SELF_BIND`, so one rule serves every channel the tenant launches.

## Not losing a purchase

Every failure path puts the buyer back where they were:

- **Dispatcher exhausts its attempts** → the event is *parked* (`dead_at` set),
  not deleted. `GET /api/monetization/outbox/parked` lists it with the error;
  `POST /api/monetization/outbox/replay` requeues it.
- **The turn fails after claiming a direction** → the direction returns to the
  queue. The credit is spent only *after* the turn succeeds, so a failure costs
  nothing.
- **The credit disappears mid-turn** (a concurrent turn took it) → the turn still
  publishes and the direction returns to the queue. A rare free direction beats a
  corrupted slot queue; it is logged as
  `"Paid direction published without a spent credit"`.

## Deployment

1. Apply `migrations/*_install_portalshq_monetization.sql`, then run Drizzle for
   the app's own `prompt_requests`.
2. Set `STRIPE_SECRET_KEY` — a **restricted** test key (`rk_`), not `sk_`. The
   platform is merchant of record, so it needs customer + charge write and
   Connect read.
3. Set `STRIPE_WEBHOOK_SECRET` from `stripe listen` or the endpoint's signing
   secret. Without it `/api/monetization/webhook` returns 503 and nothing settles.
4. Set `MONETIZATION_DRAIN_TOKEN` before exposing the drain or replay routes.
5. Optionally set `OPENMETER_ENDPOINT`. Metering is fire-and-forget and must never
   block settlement.

## Installing the packages

The three packages are published to npm and installed as normal dependencies —
no symlinks, no local tarballs:

```json
"@portalshq/monetization": "^0.2.0",
"@portalshq/platform-billing": "^0.0.5",
"@portalshq/policy": "^0.0.5"
```

They are published by the Release Engine workflow in `portalshq/portals-cloud`
(via npm Trusted Publishing), so a release there is what makes a version
available here. To move to a new version, land the package change first, then
bump the range here.

## Verifying it

See [`monetization-test-checklist.md`](./monetization-test-checklist.md). The
automated core is:

```bash
npx vitest run server/monetization   # 6 tests, no network needed
```

## Known gaps

- Policy lineage has no producer, so royalty splits and tenant payouts are not
  exercised end to end.
- Metering has no tests.
- `@portalshq/policy` and `@portalshq/platform-billing` have no tests of their own.
- The app's `tsc` needs `--max-old-space-size=8192`; it OOMs at the default 2GB.
  That is a pre-existing property of this codebase, not of monetization.
