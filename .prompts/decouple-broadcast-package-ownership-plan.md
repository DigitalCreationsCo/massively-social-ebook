# Decouple game ticks, generation, content queuing, and stream playback

Revised implementation plan, based on the current app working tree and `../cloud/packages` source inspected on 2026-09-04. This replaces the pasted proposal. Implementation has not been performed.

## Objective and compatibility contract

Reduce application orchestration by moving reusable mechanics into the applicable Portalshq packages. Preserve application behavior, persisted data, public APIs, event payloads, narrative order, scheduling, and player controls. Treat improved buffering as a separately gated change after a behavior-preserving extraction.

Do not introduce new startup delays, shorten content, change narrative context, alter session start/completion rules, or increase generation spending by default. Buffering can reduce generation-related gaps; it cannot guarantee uninterrupted playback during arbitrary provider, origin, or network failures.

## Findings that change the original proposal

- The app already declares `@portalshq/capability-queue-broadcast` ^0.1.5, `capability-video-delivery` ^0.1.4, `capability-realtime-fanout` ^0.1.4, and `runtime-core` ^0.0.5. These match the inspected cloud package versions. Verify installed and released artifacts during implementation; sibling source alone does not establish deployed capabilities.
- Canonical `produceEpisode()` awaits `ensureStagedSlots(cursor + 2)` before releasing the current slot, so preparing future content can block ready content. It also awaits terminal job monitoring before proceeding.
- Ambient generation already runs in a background pipeline. Its generation/staging capacity guards and separate one-released-turn guard constrain overlap. Removing only one guard does not establish safe buffering.
- Ambient preparation uses a shared pending-segment array and generation counter. Canonical preparation reads previous narrative context. Raising concurrency without sequencing these dependencies risks changed or duplicated content.
- `QueueBroadcastClient` already supports independent asset staging, deterministic slots, idempotent release, legacy pairs, job observation, and playback discovery. Reuse these APIs.
- `LiveDelivery` currently manages manifest connection and health, not queue scheduling or browser playback. The app's `VideoDeliveryPlayer.tsx` owns native HLS/hls.js setup and reconnect mechanics.
- `RealtimeEngine` already supplies presence, schedule rechecks, viewer-independent activation, and serialized per-channel ticks. Broadcast `tick()` starts/supervises a background producer; it does not directly await generation. The separate game-loop path includes app-specific session transitions and locks; preserve both paths.
- `InMemoryFanoutBus` is process-local and non-durable; `publish()` waits for subscriber completion. Moving code into it alone does not isolate slow subscribers.
- `narrative-engine-adapter` and `text-image-delivery` expose placeholder methods that throw. They are not migration destinations for working functionality in this change.

## Ownership boundaries

| Domain | Package owner and reusable responsibility | Application responsibility |
| --- | --- | --- |
| Content queue and production pipeline | `queue-broadcast`: bounded preparation scheduling, ordered ready/staged/released slots, capacity accounting, upload/release retries, job monitoring, reconciliation hooks, queue health | Select canonical/ambient content; supply immutable preparation requests, narrative context, deadlines, fallback policy, and storage adapters |
| HLS delivery and stream playback | `video-delivery`: `LiveDelivery`, manifest health, reusable browser source attachment, native HLS/hls.js lifecycle and reconnect behavior | Player presentation, controls, copy, analytics binding, channel selection and authorization |
| Realtime game-loop mechanics | `runtime-core`: `RealtimeEngine`, independent timers, activation/recheck lifecycle, cancellation and stale-run protection | Session rules, phases, scheduled boundaries, game locks, persistence and transitions |
| Message fanout | `realtime-fanout`: pub/sub, subscriber lifecycle, external-chat transport primitives, optional bounded delivery isolation | Authentication, authorization, persisted chat deduplication, channel/topic mapping, existing WebSocket payloads and business events |
| Narrative and media creation | Existing `@portalshq/narrativeengine` integration and applicable generation providers | Prompts, selected references, previous-context ordering, canonical block persistence, TTS segmentation, archived-image/image-only fallback policy |
| Shared contracts | `contracts`, only for types genuinely shared across package boundaries | App database rows, `WsMessage`, session enums and UI types remain local |

Keep preparation scheduling in `queue-broadcast`: its backpressure and deadlines are determined by queue consumption. Do not put a media-specific worker pool in `runtime-core`, a queue controller in `video-delivery`, or game rules in `realtime-fanout`.

The Streamer service remains authoritative for normalization, FIFO execution, image/audio synchronization, and encoded stream continuity. SDK buffering cannot fix an origin that inserts black frames. Existing low-level queue streaming exports stay compatible; do not relocate them merely to rename ownership.

## Composition and state contracts

The app composes four independent capabilities rather than implementing four new local controllers:

1. A lightweight game tick evaluates app state and emits bounded preparation intent. It never waits for generation, uploads, playback completion, or slow fanout subscribers.
2. A package-owned preparation pipeline invokes an injected app callback and commits results in deterministic order.
3. A package-owned release scheduler consumes eligible staged slots using app-supplied scheduling constraints. Monitoring proceeds independently.
4. `video-delivery` consumes the discovered HLS source. Fanout distributes app-mapped observations without becoming the authoritative queue or session store.

Proposed queue APIs (new work, not existing exports) should expose preparation callbacks, receipt persistence/recovery hooks, release eligibility, bounded capacity, clock/abort injection, and status subscriptions. Keep the surface small; begin with one pipeline facade over focused internal modules, not separate app-facing worker/buffer/controller frameworks.

- Identify work by channel, run epoch, logical content key, and segment ordinal. Preserve existing deterministic slot/idempotency keys and legacy pair receipts.
- Model preparing, prepared, staged, released, completed, terminally failed, and cancelled work explicitly. An upload receipt is not proof that normalized media is ready to play. Verify actual Streamer status semantics before counting playable seconds.
- Persist individual image/audio receipts through the app adapter as today. Reconcile uncertain upload/release outcomes with existing queue identity before retrying. Do not promise exactly-once network delivery; use idempotent operations and ordered, durable cursor commits.
- Parallel completions must not overwrite a block's other segment receipts or advance the cursor past an unfinished earlier slot. Serialize per-block persistence and advance only the contiguous terminal prefix.
- Keep canonical narrative turns sequential per context chain; parallelize independent channels and already-independent media work. Preserve ambient turn-to-segment ordering before allowing concurrent preparation.
- Reserve capacity before starting work. Account for prepared bytes, outstanding work, staged duration, and released duration separately; shared image assets must not be counted repeatedly. Bound estimates and reconcile actual durations.
- On stop/restart, fence old-run results, abort and join local work, and preserve current persisted desired-state semantics. Local abort does not cancel already released remote jobs. Inventory remote cancellation/discard support before changing release depth; keep committed remote work in recovery and schedule accounting.
- No packages import app storage, schema, logger globals, or environment configuration. Pass typed options/adapters. Avoid reverse dependencies: video delivery must not depend on the queue SDK to obtain a source.

## Implementation phases

### 1. Establish the behavior baseline

Record current outputs and transition timing from coordinator, ambient pipeline, media-slots, runtime, game-loop, chat, and player paths. Preserve the existing tests for single-slot behavior during extraction. Capture defaults and environment precedence directly from code.

Baseline receipt formats, cursor keys, legacy pairs, release-triggered activation, terminal-failure cursor advancement, schedule/pre-roll behavior, viewer counts, operator stop/restart, shutdown, and unavailable-Streamer suppression of generation. Include non-broadcast/on-demand sessions.

Inspect the Streamer implementation/API for readiness, duration, FIFO, cancellation, and restart guarantees. SDK method comments are insufficient evidence for deeper release windows. Measure whether black space originates before release, during normalization, in encoding, or at the browser.

### 2. Extract queue mechanics with existing behavior

In `../cloud/packages/queue-broadcast/src/`, add a pipeline facade and internal preparation, buffering, release, and receipt-reconciliation modules. Extract reusable logic from app `ambient-pipeline.ts` and coordinator staging/retry/monitoring methods. Extend existing package tests and exports.

Initially preserve the current capacity, release depth, fallback decisions, retry behavior, and ordering. The app's `coordinator.ts` becomes a programming policy adapter; `media-slots.ts` remains responsible for domain preparation and storage mapping. Keep temporary forwarding adapters only during migration, then remove duplicate orchestration.

Do not add the originally proposed app-local `generation-workers.ts`, `content-buffer.ts`, or `playback-controller.ts`.

### 3. Separate ready-content release from future preparation

Make canonical preparation background work so an eligible ready slot does not wait for generation of a later slot. Let ambient preparation/staging overlap monitoring within bounded capacity. Preserve preparation eligibility and the existing Streamer availability/cost gate.

Enable deeper remote release only after origin semantics and boundary tests pass. Compute admissible ambient duration from all committed remote work plus the candidate and safety margin relative to the next canonical start. Locally staged future ambient work is not committed playback; hold or invalidate it when plans change. Prefer conservative accounting when remaining playback time is unavailable.

Do not release arbitrary future work based only on buffer depth. Preserve canonical ordering, session expiry, and context freshness. Do not require a new 30-second startup buffer or silently add shorter fallback content. Keep existing image-only and archived-image fallbacks.

### 4. Complete delivery ownership

Retain `LiveDelivery` for server-side HLS health. Add a browser-safe subpath to `video-delivery` for a framework-independent player controller, extracting source attachment, reconnect, cleanup, and native HLS selection from `VideoDeliveryPlayer.tsx` without changing settings or events.

Keep React UI and analytics callbacks in the app. Test source changes, autoplay rejection, mute, pause/resume, reconnect limits, cleanup and native HLS. Ensure browser exports do not pull server queue credentials or Node-only dependencies into the bundle. Origin encoding fixes, if required, belong in the Streamer implementation, not this controller.

### 5. Keep tick and fanout execution independent

Reuse `RealtimeEngine`; add only missing generic lifecycle safeguards demonstrated by integration tests. App callbacks retain game rules and database locking. Do not introduce a second session authority or change tick cadence as part of extraction.

Reuse `Chat`, existing external-chat primitives, and the fanout bus. Extract any remaining generic transport mechanics while retaining persistence-before-publish, external message deduplication and existing endpoint/topic identity. If slow-subscriber isolation is needed, add an explicit bounded delivery mode rather than silently changing `publish()` completion semantics. Define ordering and overflow behavior; do not drop chat or game decisions under a heartbeat-coalescing policy. Durable/multi-process delivery is separate scope.

### 6. Package rollout and configuration

Build/test and version additive cloud APIs before upgrading app dependencies and lockfile. Verify the packed artifacts' actual exports. Keep old exports, public app response shapes, configuration aliases, and persisted records compatible. Remove optional compatibility casts only after the app's minimum installed versions guarantee the required methods.

Keep environment parsing in app `config.ts`. Preserve existing `BROADCAST_AMBIENT_*` settings and defaults; map them into package options. Introduce new tuning settings only for implemented controls with validated bounds and explicit precedence. Treat the original 60/30/120-second and three-worker suggestions as experiments, not new defaults.

Roll out extraction first. Gate deeper buffering separately per channel, with exactly one active queue writer. Shadow comparisons must not generate paid content or release duplicate jobs. Rollback must reconcile already released work before returning control to the old scheduler.

## Verification and acceptance gates

Package tests own reusable state-machine and transport behavior; app tests own domain mapping and observable compatibility. Run existing suites first and report pre-existing failures separately from regressions.

- Queue: out-of-order preparation, bounded reservations, partial asset failure, uncertain release response, duplicate retry, terminal failure, contiguous cursor updates, persisted receipt recovery and stale-run completion.
- Scheduling: ready canonical playback during stalled future generation; ambient FIFO reservations at episode boundaries; schedule changes; session expiry during preparation; stop/restart during upload, release and monitoring.
- Independence: deferred generation does not stop ticks or current playback; a slow subscriber does not block the selected isolated delivery mode; one unavailable channel does not stall another.
- Compatibility: image-only and archived-image fallback, TTS segment order, selected references and context, legacy receipts, unavailable-origin cost gate, status/API/WebSocket contracts, chat deduplication and viewer behavior.
- Playback: actual image/audio transitions through the Streamer and HLS player, native HLS and hls.js reconnection, no player remount from unrelated status changes, unchanged controls and analytics bindings.
- Observe generation latency, prepared/staged/playable seconds, released backlog, bytes, normalization latency, underruns, visible black-frame duration, tick lag and subscriber lag separately. A successful manifest request is not proof of healthy content continuity.

Accept extraction only when observable behavior matches the baseline. Accept buffering changes only when measured gaps improve without altered programming order, added startup delay, episode-boundary regressions, unbounded spending or memory growth. Any remaining origin/player limitation must be reported rather than hidden behind a claim that buffering eliminates all black space.

## Source references

App: `package.json`; `server/broadcast/{coordinator,ambient-pipeline,media-slots,runtime,config}.ts` and their existing tests; `server/game-loop/channel-tick.ts`; `server/chat/gateway.ts`; `client/src/components/VideoDeliveryPlayer.tsx`.

Cloud: package manifests and `queue-broadcast/src/client.ts`; `runtime-core/src/realtime-engine.ts`; `video-delivery/src/live-session.ts`; `realtime-fanout/src/fanout-bus.ts`; `narrative-engine-adapter/src/narrative-engine-adapter.ts`; `text-image-delivery/src/chapter-feed.ts`.
