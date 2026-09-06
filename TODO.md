# Broadcast scheduling: durable canonical refill worker

## Problem

Canonical episode preparation currently prefetches the next text turn while
media/staging runs, but one coordinator loop still owns retrieval, PX, text,
image generation, archive/persistence, staging, release, and job monitoring.
When an upstream image or TTS provider is slow or quota-limited, the staged
queue can drain before the next slot is ready. The HLS player then stalls.

The player retains its last decoded frame during a stall, but that is viewer
protection—not a replacement for maintaining a queue buffer.

## Required architecture

Make these independently supervised, cancellable tasks for each channel/run:

1. **Canonical refill worker**
   - Builds RAG context and optional PX enrichment.
   - Generates the next canonical text block, then its image/audio assets.
   - Persists a checkpointed block and emits a prepared slot.
   - Keeps a configurable target number of prepared canonical slots ahead.

2. **Slot staging worker**
   - Consumes prepared slots in canonical order.
   - Uploads image/audio independently with idempotency keys.
   - Records stage receipts and handles image-only degradation.

3. **Queue release/monitor worker**
   - Releases staged slots FIFO only when buffer policy permits.
   - Watches queue job state and advances the durable playback cursor.
   - Does not wait for RAG, PX, image generation, or archive operations.

4. **Playback watchdog**
   - Starts delivery automatically at runtime startup.
   - Monitors manifest health independently of browser status polling.
   - Reports an empty/stalled stream and triggers refill urgency; it never
     makes a viewer interaction necessary to resume playback.

## Constraints

- Preserve canonical ordering: only text generation is sequential; media and
  staging can overlap after each text checkpoint is durable.
- Retain a bounded buffer (for example 3 staged/released visuals) and expose
  the counts, age of oldest slot, and refill latency in broadcast status.
- Provider quota failures should take the archived-image/image-only fallback
  path quickly; avoid spending a whole buffer lifetime on doomed retries.
- One run-level abort signal must stop all four workers and await cleanup.
- Maintain idempotency and crash recovery from persisted block/slot receipts.

## Acceptance tests

- Simulate a multi-minute image-provider timeout while existing slots play:
  release/staging continues and the queue retains its configured minimum when
  possible.
- Simulate TTS failure: image-only slots continue FIFO playout.
- Simulate queue or manifest outage: workers recover automatically without a
  viewer refresh; no duplicate slots are released after recovery.
- Simulate restart mid-generation and mid-stage: resume from durable cursor
  and receipts without re-generating/releasing prior canonical slots.
# Current implementation status: see `docs/story-generation-status.md`.
