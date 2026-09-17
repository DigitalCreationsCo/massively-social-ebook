# Coding assistant instruction: extract broadcast, realtime, and billing domains into Portals packages

This instruction replaces the earlier decoupling plan. It is based on the current `massively-social-ebook` application and sibling `../cloud/packages` source reviewed on 2026-09-12. Implement it as a behavior-preserving extraction, not a greenfield redesign.

## Goal

Reduce application-owned infrastructure and orchestration by moving reusable content preparation, queue, live-delivery, playback, realtime-loop, fanout, and billing mechanics into the Portals packages that own those domains. Leave the application with programming policy, game rules, presentation, authorization, and composition.

Make package changes additive first, publish or link them, migrate the application, and remove obsolete local implementations only after compatibility tests pass. Do not combine behavior changes with ownership moves.

## Non-negotiable compatibility contract

The current application is the baseline. Preserve:

- Public HTTP and WebSocket shapes, persisted receipt formats and keys, session transitions, activation rules, viewer behavior, operator stop/restart behavior, and configuration defaults.
- Canonical programming order, selected references, narrative context, block persistence, TTS segment order, image-only and archived-image fallbacks, duration/retry policy, and generation cost gates.
- Three canonical slots of pre-roll, serial canonical release, current ambient duration/byte/in-flight limits, and the two-block ambient narrative chain. Count a shared visual used by multiple narration segments once for visual capacity.
- Captions attached only to the currently playing queue job, sidecar tracks, held-frame masking during buffering/reconnect, native HLS and hls.js behavior, retry limits, controls, events, and analytics.
- Absolute scheduled start/end timestamps used by browser countdowns and progress. Tick extraction must not introduce drift or turn the server into a one-second UI broadcaster.
- Non-broadcast and on-demand game sessions, including scheduled, active, decision, and completed transitions and their existing locks/idempotency.

Do not add startup delay, change content length, increase generation concurrency/spend by default, reorder releases, or change tick cadence. Gate deeper buffering and tuning until the behavior-preserving extraction passes all acceptance tests.

Do not change `text-image-delivery`, `narrative-engine-adapter`, ebook application storage/schema, application logger globals, or application environment parsing. Billing may add a package-owned persistence contract and cloud billing migrations because durable webhook processing requires them; do not couple these to the ebook application's storage.

## Findings that supersede the old plan

1. The app now uses queue-broadcast ^0.1.7, video-delivery ^0.1.6, realtime-fanout ^0.1.6, runtime-core ^0.0.7, narrativeengine ^0.8.15, and px ^0.8.19. Verify packed artifacts and lockfiles during implementation; sibling source does not prove installed exports.
2. `server/broadcast/coordinator.ts` prepares a canonical text window of up to three turns in one ordered provider response. Its prompt makes each turn continue the prior turn within that response, after which media and persistence proceed in order.
3. The installed NarrativeEngine exposes `generateBlocksBatch()` (there is no `generateContextBatch()` API). It alleviates the earlier canonical dependency concern in the current app because the app's batch provider produces one internally dependent ordered window in one provider call, and NarrativeEngine persists returned drafts in request order. NarrativeEngine builds each retrieval context concurrently from the same pre-batch canonical state, so the provider's within-batch chaining remains essential; this API does not make separate parallel dependent LLM calls safe. Preserve one batch per window, validate its exact length/order, and commit blocks serially.
4. Canonical pre-roll is deliberately three slots ahead. Future staging overlaps current playout. Ambient preparation is separately bounded by ready duration, bytes, generation count, queued content, and visual identity. Preserve those constraints.
5. The app player now owns captions, native-HLS/hls.js selection, held-frame capture, reconnect, and source-change behavior. These reusable mechanics belong in video-delivery; a thin application presentation wrapper should remain.
6. runtime-core supplies channel timers and serialized callbacks but no public time counter. The app computes loop timing in `server/game-loop/channel-tick.ts`; `LiveBroadcastSection` and `DecisionPhase` interpolate display countdowns from absolute deadlines.
7. realtime-fanout owns an in-memory bus and chat primitives, while the app still owns generic WebSocket connection maps, membership, send loops, and duplicate external-message normalization.
8. There is no production `@portalshq/billing`. The sibling billing-engine, billing-marketplace, and billing-metering packages are incomplete Lago/OpenMeter wrappers or speculative payout math. The cloud frontend already calls Stripe directly. No working first-party Super Chat implementation was found in the reviewed app/v1 code; do not preserve imaginary APIs.

## Final ownership boundaries

| Domain | Owner | Package responsibility | Application responsibility |
| --- | --- | --- | --- |
| Queue and preparation | `queue-broadcast` | Deterministic identities, upload/stage/release/watch primitives, bounded preparation, reservations, ordered commits, reconciliation, cancellation/fencing, observations | Canonical/ambient callbacks, prompts/references, fallback policy, immutable programming metadata, persistence adapters |
| Live programming/delivery | `video-delivery` via `LiveDelivery` | Delivery health, schedule/deadline evaluation, eligible staged-work release, playback discovery, caption projection, reconnect policy, browser controller and React base player | Channel programming policy and server credentials; presentation, controls, styling, analytics, overlays |
| Realtime loop/time | `runtime-core` | Serialized per-channel lifecycle, injected clocks, tick sequence/context, countdown snapshots, cancellation and stale-run fencing | Session/game rules, domain locks, persistence, transition deadlines |
| Fanout/socket mechanics | `realtime-fanout` | Topic subscriptions, connection lifecycle, bounded send queues, serialization hooks, external-chat normalization, ordering/overflow contracts | Socket authentication/authorization, app-event mapping, persistence-before-publish |
| Channel billing | new `@portalshq/billing` | Stripe platform client, Connect, per-channel profiles, Checkout/Billing, destination charges/fees, webhooks, refunds/disputes, meter events, durable billing events | Authenticated actor/channel, catalog configuration, owner relationship, approved URLs, mapping settled events to product behavior |
| Narrative/media policy | existing narrative/generation providers | Existing generation capability | Prompts, reference selection, story semantics, provider choice, domain persistence |

Keep dependencies one-way:

```text
massively-social-ebook
  -> runtime-core
  -> realtime-fanout
  -> queue-broadcast
  -> video-delivery -> queue-broadcast (server-only integration)

cloud billing services
  -> @portalshq/billing -> Stripe SDK
  -> realtime-fanout (cloud composition only, after settlement)
```

queue-broadcast must not import video-delivery. Billing must not import the ebook app or directly publish to a process-local bus. Browser exports must not include server credentials, Node modules, Stripe, or queue administration code.

## 1. queue-broadcast: own preparation and queue state

Keep existing low-level APIs compatible. Add one small public `ContentQueuePipeline<TRequest, TPrepared>` facade backed by internal modules. It owns:

- Capacity reservation before work starts, with distinct preparing, prepared, staged, released, completed, terminal-failed, and cancelled states.
- Limits for in-flight preparation, ready duration, bytes, content count, and visual identity. Accept application accounting for narration segments sharing a visual.
- Stable identity from channel, run epoch, content key, block/segment ordinal, and current queue idempotency keys.
- Abort, run fencing, stale-result rejection, retry classification, and reconciliation after uncertain network results.
- Per-block receipt serialization so parallel assets cannot overwrite siblings. Advance only a contiguous terminal cursor.
- Ordered observations and recovery from persisted receipts. Promise idempotent intent and deterministic recovery, not exactly-once networks.
- Queue job monitoring independent of new preparation.

Application callbacks return prepared assets/metadata and retain narrative/fallback decisions. Obtain canonical text once with `generateBlocksBatch()` for the ordered window, then enter its blocks into media preparation in order. Parallelize independent media work only where current behavior already does. Preserve the ambient two-block chain and all limits.

Do not add app-local `generation-workers.ts`, `content-buffer.ts`, or another queue state machine. After migration, remove `server/broadcast/ambient-pipeline.ts` and generic staging/retry/monitoring from the coordinator, retaining thin policy adapters.

## 2. video-delivery: make `LiveDelivery` the scheduling and playback facade

LiveDelivery should compose queue primitives through a server-only adapter and own live release scheduling. It must not own story selection or generation.

Add a typed programming contract similar to:

```ts
type DeliveryCandidate = {
  queueIdentity: QueueIdentity;
  kind: "canonical" | "ambient";
  eligibleAt: Date;
  expiresAt?: Date;
  estimatedDurationMs: number;
  priority: number;
};

interface LiveProgrammingPolicy {
  nextCandidates(context: DeliveryScheduleContext): Promise<DeliveryCandidate[]>;
  canRelease(candidate: DeliveryCandidate, context: DeliveryScheduleContext): boolean;
}
```

Keep this policy in the application. LiveDelivery owns clock evaluation, one-writer lease/fence, release idempotency, health/cost gate, monitoring, and current-playback projection. Preserve the app's scheduled start/end, current job/caption, availability, and retry state through a mapping adapter.

Canonical content stays serial. Ready canonical playback must not await later generation. Ambient may fill only the admissible gap before the next canonical boundary. Include all remotely committed work, the candidate, and a safety margin. Locally staged work is not committed playout. Do not deepen release until integration tests prove Streamer FIFO, readiness, duration, cancellation, and restart semantics.

### Browser and React ownership

Add framework-independent machinery in `capability-video-delivery/browser` and a base component in `capability-video-delivery/react`:

- `HlsPlaybackController` owns native HLS/hls.js selection, attach/detach, manifest/media recovery, bounded reconnect/backoff, source changes, autoplay rejection, teardown, and observations.
- Package `VideoDeliveryPlayer.tsx` owns the video ref, controller lifecycle, caption-track lifecycle, held-frame continuity, and accessible media-state callbacks.
- An external-player adapter receives the resolved HLS source, captions, reconnect coordinator/signals, and delivery observations, and reports playback/errors back. Video.js or another player can be used without reimplementing Portals HLS/reconnect logic.
- Use focused render props/slots for controls and overlays. Keep app branding, layout, copy, analytics, and channel UI in the app.

Keep React as peer dependencies, isolate hls.js to browser exports, and prove server entry points do not bundle browser code. Migrate the app player without changing tested DOM behavior, then remove duplicate app HLS/reconnect/caption code.

## 3. runtime-core: expose time counter and tick context

Add public `TimeCounter`, with one instance per active channel inside `RealtimeEngine`. Accept injected clocks and expose tick progress plus deadline countdowns:

```ts
interface TickContext {
  sequence: number;
  now: Date;
  startedAt: Date;
  previousTickAt?: Date;
  elapsedMs: number;
  deltaMs: number;
  intervalMs: number;
  countdown(endsAt: Date, startsAt?: Date): CountdownSnapshot;
}

interface CountdownSnapshot {
  observedAt: Date;
  startsAt?: Date;
  endsAt: Date;
  totalMs?: number;
  elapsedMs?: number;
  remainingMs: number;       // zero-clamped
  remainingSeconds: number;  // ceil while positive
  progress?: number;         // 0..1 when start is known
  expired: boolean;
}
```

Change callbacks additively to `onTick(channelId, context)`; existing callbacks may ignore argument two. Use wall time for persisted deadlines and a monotonic source for elapsed/delta so clock correction cannot create negative duration. Sequence starts at 1 for each activation epoch. Do not reset it for harmless schedule rechecks.

Use `context.countdown()` in `server/game-loop/channel-tick.ts` for scheduled start, active/decision boundaries, and session end while preserving transition predicates/locks. Add an optional status timing snapshot only for browser clock calibration; retain current scheduled timestamps. Browsers interpolate locally from absolute deadlines and latest `observedAt`, without one fanout per second.

Test delayed ticks, wall-clock jumps, exact deadline expiry, reactivation, cancellation during callback, and no overlapping callback per channel with fake clocks.

## 4. realtime-fanout: own connection and delivery mechanics

Retain Chat, external-event, UUID, and bus exports. Add transport-neutral `FanoutHub` owning connection registration, topic membership, cleanup, ordered per-connection send queues, serialization, heartbeat/coalescing policy, and bounded backpressure.

The app supplies authenticated metadata and authorization. It persists chat/decisions before publishing and maps existing `WsMessage` values to package topics. Remove duplicate external normalization from the app gateway.

Define overflow by class:

- Presence/health snapshots may coalesce to the newest.
- Chat, decisions, paid-message settlement, and transitions remain ordered and cannot silently drop.
- Slow subscribers cannot block ticks or other connections; disconnect them with a typed reason when their reliable queue is exhausted.

Keep the in-memory bus for local/single-process use and tests. Do not call it durable or multi-process. Add a broker adapter only if deployment requires one; do not create a new broker package for this migration.

## 5. New `@portalshq/billing`: Stripe platform and Connect as the only money rail

Create `../cloud/packages/billing` and migrate cloud billing into it. Use the Portals Stripe platform account for every operation. Connected owners never provide application API keys.

Replace billing-engine, billing-marketplace, and billing-metering financial responsibilities. Remove them, Lago/OpenMeter financial sync jobs, guessed fee math, and billing-only deployment resources after consumers migrate. Keep unrelated operational metrics. Do not preserve speculative royalty/rake APIs or adapters to incomplete features.

### Channel model

A channel billing profile contains:

- `channelId` and `ownerId`.
- `stripeCustomerId`, representing the channel for fees, subscriptions, invoices, credits, and usage Portals charges it.
- `stripeConnectedAccountId`, receiving purchases made to that channel's owner.
- Onboarding state, charges/payout capability state, country/currency defaults, and timestamps.

Customer and connected account ids have different meanings. Multiple channels may share an owner's Connect account only where ownership explicitly permits; each channel retains its own profile/customer. Audience buyer Customers never replace the channel Customer.

Use Accounts v2 for new connected accounts when the installed SDK/platform supports the needed merchant configuration; preserve existing `acct_` ids with a typed compatibility path. Default to Stripe-hosted onboarding and refresh capability status from signed webhooks. Opening onboarding is not proof of readiness.

### Package API

Expose one cohesive `PortalsBilling` service with typed methods:

- `ensureChannelProfile()` / `getChannelProfile()`
- `createConnectOnboardingLink()` / `createConnectDashboardLink()`
- `createCustomerPortalSession()`
- `createChannelCheckout()` including Super Chat
- `reportMeterEvent()`
- `refundPurchase()`
- `handleWebhook()`

Inject `BillingStore`, `BillingCatalog`, clock, id generator, and durable outbox sink. The package owns validation/transitions. Calls provide stable actor/channel/product ids and approved URLs, never raw destination accounts, prices, transfer amounts, or fees.

Use integer minor units and lowercase ISO currencies. Resolve product, price, amount range, currency, platform fee, and purchase kind from a server catalog. Never trust browser money/Connect values. Use a restricted platform key where possible. Reuse the workspace Stripe v22 SDK rather than downgrading and pin its supported API version.

### Purchases and owner payouts

Use Checkout Sessions and Connect destination charges:

1. Authorize buyer/channel, resolve catalog product, and verify the connected account can receive funds.
2. Persist a pending purchase before Stripe. Use its id as Stripe idempotency key and metadata with channel id, purchase kind, and schema version. Put no message content or personal data in metadata.
3. Create a `payment` Checkout Session from server line items. Set `payment_intent_data.transfer_data.destination` to the owner's account and `application_fee_amount` from catalog policy. Omit `payment_method_types`. Provide the required Checkout integration identifier for the pinned API.
4. Treat webhooks as authoritative. Settle only from paid Checkout completion or asynchronous-payment success; redirect success is not payment proof.
5. Record actual charge, PaymentIntent, transfer, application fee, balance transaction, fee, and net data. Never estimate Stripe fees.

Destination-charge fees, refunds, and disputes debit the platform. Model this explicitly. Refunds must reverse the destination transfer and refund the application fee when policy requires. Support partial refunds idempotently. For disputes, record the platform debit, attempt policy-authorized transfer reversal, and expose failed recovery; never fabricate owner clawback.

Use `on_behalf_of` only through explicit validated policy when the connected account must be settlement merchant because it changes descriptors, currency, and regional constraints.

### Super Chat

Add `super_chat` as a channel purchase kind, not a separate payment system. Reuse `createChannelCheckout()` and the same webhook state machine. Validate message/amount through the server catalog and current chat length/safety rules. Store message text in the product record, never Stripe metadata.

After settlement and durable commit, append one idempotent `billing.purchase_settled` outbox event. Cloud composition maps a Super Chat settlement to the existing chat/event model and publishes through realtime-fanout, deduped by purchase id. Never publish or grant prominence from a Checkout redirect.

External-provider paid messages are provider events only. Do not create Portals charges/payouts for purchases made on YouTube/Twitch.

### Subscriptions, usage, and webhooks

Migrate existing cloud subscriptions, Checkout/customer portal routes, products/prices, and webhook behavior behind billing without changing B2B behavior. Use Stripe Billing prices/subscriptions and Stripe Billing meter events for billable usage. Retire Lago/OpenMeter as financial sources of truth; never dual-bill.

Keep operational analytics separate. Meter events must be idempotent/retryable and keyed to the channel's Stripe Customer. Validate configured meter/event names/values and do not swallow failures.

Verify webhooks against the raw body. Uniquely persist every Stripe event id and process transactionally. Support relevant Checkout async completion/failure, PaymentIntent, refund, dispute, application-fee/transfer, invoice/subscription, meter, and Connect account events.

BillingStore must atomically claim an event, transition a purchase, append ledger entries, and append the outbox. Duplicate/out-of-order events converge. A dispatcher publishes committed events; webhook handlers never call WebSockets directly. Redact secrets/client secrets.

## Application end state

The coordinator becomes a small programming/policy adapter: choose canonical/ambient content, invoke generation/persistence callbacks, and map package status to unchanged APIs. It no longer owns reservations, retry loops, queue monitoring, HLS health, or playback state.

Broadcast runtime wires RealtimeEngine, ContentQueuePipeline, and LiveDelivery with no parallel retry scheduler. Channel tick contains only game/session rules and consumes TickContext. The socket gateway authenticates/maps messages but delegates connection/send mechanics. The client player is a styled wrapper around package VideoDeliveryPlayer or an external adapter.

The ebook app does not import billing. Monetization runs in cloud billing and reaches the app through authenticated settled events only if Super Chat is enabled.

## Implementation order

### A. Characterize current behavior

Run existing app/package suites. Add focused characterization tests only for unprotected behavior: three-slot canonical order, two-block ambient chain/capacity, shared-image accounting, caption selection, held-frame reconnect, session timing, unavailable-Streamer cost gate, and stop/restart fencing. Capture API/WebSocket fixtures/defaults.

Inspect deployed Streamer FIFO, normalization readiness, duration, cancellation, status, and restart semantics. Do not infer them from SDK comments.

### B. Add package APIs

Implement/test TimeCounter/TickContext, ContentQueuePipeline, LiveDelivery scheduling, browser controller/base React player/external adapter, and FanoutHub. Preserve old exports and create explicit server/browser/react entry points with bundling tests.

Create billing with typed Stripe service, store/outbox ports, and webhook state-machine tests. Migrate one current cloud Stripe flow through it before Super Chat.

### C. Migrate seams individually

1. Adopt runtime tick context without changing outputs.
2. Adopt queue preparation with current limits and one writer.
3. Adopt LiveDelivery scheduling/status mapping at current release depth.
4. Replace player internals while preserving presentation.
5. Replace socket mechanics/duplicate normalization.
6. Migrate cloud subscription/customer/Checkout/webhooks to billing, then add destination-charge purchases and Super Chat settlement fanout.

Delete each replaced implementation after its compatibility tests pass. Never leave two active schedulers, webhook processors, or queue writers.

### D. Remove obsolete billing and tune only afterward

After consumer and production-replay verification, delete old billing packages, Lago/OpenMeter financial bridges/sync jobs, stale references, and obsolete monetization plan text. Preserve unrelated observability.

Only afterward test deeper release/buffering or higher preparation concurrency behind a per-channel flag. Shadow evaluation cannot create generation spend, Stripe charges, or duplicate releases. Rollback must reconcile remote releases and Stripe idempotency state before switching writers.

## Required verification

Queue/delivery:

- Ordered `generateBlocksBatch()` output, malformed/partial fallback, serial persistence, and no parallel dependent LLM requests.
- Out-of-order asset completion, shared-image accounting, reservations, partial/uncertain network failure, duplicates, recovery, and stale results.
- Ready canonical playback during future-generation stalls; ambient cannot cross canonical boundary; stop/restart leaves one writer.
- Native HLS/hls.js, source replacement, autoplay, mute/pause, captions, held frame, reconnect, cleanup, external adapter, and analytics.

Runtime/fanout:

- Fake-clock tick sequence/delta/elapsed, exact countdown boundary, delayed ticks, clock correction, cancellation, reactivation, serialization.
- Scheduled/on-demand transitions and decision countdowns remain compatible.
- Connection order, coalesced presence, reliable chat/decision/paid events, slow-subscriber isolation, cleanup, dedupe, persistence-before-publish.

Billing:

- Connect incomplete/complete/disabled states and existing-account compatibility.
- Correct channel owner destination, fee policy, Checkout idempotency, async payment, abandonment, duplicate/out-of-order webhooks.
- Actual fee/net recording, full/partial refund and reversals, fee-refund policy, disputes/platform liability, failed reversal.
- Channel Customer isolation, multi-channel owner, subscription/portal compatibility, meter retry/idempotency, and no browser-trusted money/account data.
- Super Chat publishes once only after settlement; redirect, failure, refund, and webhook replay cannot duplicate it.

Use Stripe test mode, Stripe CLI fixtures, and automated tests; never real charges. Run package build/typecheck/tests, packed-export smoke tests, app build/typecheck/tests, and focused browser tests. Report pre-existing failures separately.

## Definition of done

- Observable app behavior passes with package-owned mechanics and no duplicate implementation.
- Coordinator, runtime, game tick, socket gateway, and player are smaller and contain policy/composition rather than reusable infrastructure.
- Packages document ownership, typed APIs, server/browser isolation, failure/recovery tests, and migrations.
- runtime-core exposes the time counter and the app uses it for loop-event countdown decisions while absolute browser timing remains stable.
- LiveDelivery owns queue release scheduling and supports the base player plus external players without duplicated HLS/reconnect logic.
- billing is the only Portals financial integration; all operations use the platform account, channel purchases reach the correct Connect owner, and Super Chat uses the same durable Stripe flow.
- Obsolete billing packages and financial Lago/OpenMeter paths are removed only after migrations and replay/idempotency verification.

## Sources reviewed

Application: `package.json`; broadcast coordinator, ambient pipeline, media slots, runtime, config and tests; game-loop channel tick/tests; chat gateway/runtime; client VideoDeliveryPlayer, LiveBroadcastSection, and DecisionPhase.

Cloud: package manifests/source for queue-broadcast, video-delivery, realtime-fanout, runtime-core, billing-engine, billing-marketplace, billing-metering; cloud frontend Stripe Checkout/customer/webhook code; billing control plane, ADR, and Lago/OpenMeter assets.

Stripe references: destination charges (`https://docs.stripe.com/connect/destination-charges`), Accounts v2 (`https://docs.stripe.com/connect/accounts-v2`), hosted onboarding (`https://docs.stripe.com/connect/onboarding`), and destination-charge disputes (`https://docs.stripe.com/connect/disputes`). Recheck official docs against the pinned SDK/API version while implementing.
