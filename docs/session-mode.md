# Session Mode

## Scope

A session is a scheduled canonical episode in the live broadcast. Its blocks and media are persisted for continuity and replay, then released to the Streamer's FIFO in chronological order. This differs from disposable ambient interludes. This guide covers the current broadcast coordinator, not legacy replay/game-loop behavior or unimplemented voting/candidate features.

## Lifecycle

Sessions have channel, title, optional description, scheduled start/end, timezone, and a `scheduled`, `active`, `completed`, or `cancelled` status. The coordinator exposes corresponding `none`, `scheduled`, `preparing`, `active`, and `completed` session states.

```text
scheduled -> pre-roll (start minus 3 minutes) -> durable canonical staging
          -> first FIFO release at start -> active playback and refill
          -> completed at scheduled end -> ambient mode
```

Time—not a target block count—ends a session. A process that finds an overdue active session marks it completed before doing further work.

## Entry and pre-roll

Before any generation, archive recovery, staging, or upload, the coordinator requires both a healthy Streamer control response and a successful authenticated playback-descriptor request. This validates the control API, queue token, and MediaMTX readiness. If unavailable, mode is `waiting_for_streamer`, scheduled work remains `preparing`, and retry backoff is 2/5/10/30 seconds.

At pre-roll, ambient production is stopped and joined. Because the channel has one FIFO, releasing ambient after canonical staging starts could put it ahead of the episode. The coordinator stages five canonical slots ahead by default without releasing them; it cannot retract an already released ambient slot, so that work drains naturally.

## Canonical creation and staging

`ensureStagedSlots` fills only the ordinary playback deficit, targeting five slots. Its seed is the final block of the session, then the channel's most recent canonical block, then empty context.

For a refill, `NarrativeEngine.generateBlocksBatch` creates an ordered window of up to five blocks from one RAG/PX snapshot and one structured model response. Each later item must continue the earlier item in the same response. Image/TTS preparation can overlap, but persistence and staging await results in immutable window order; a faster later image cannot reorder the canonical story.

For each usable image, the application archives image/narration media, creates the block and delivery-segment records, stages image and optional audio using deterministic session/block/segment idempotency and slot keys, and persists per-item queue receipts. A terminal narration failure leaves the staged image usable as image-only content. A block without an image is not persisted or released.

## Playback, cursor, and recovery

The setting `broadcast:<channel>:session:<session>:cursor` identifies the next delivery segment, allowing a block with split narration to resume correctly. For each segment, the coordinator starts generating/staging one additional look-ahead slot while it releases and monitors the current slot. On the first successful submission it marks the session active; after the monitor cycle it advances the cursor and waits for the top-up. This keeps FIFO release serial while next-slot work overlaps playout.

Canonical media and receipts are durable. After a restart, the coordinator finds existing blocks, stages only missing receipts, and can reload archived image/audio into the application process to complete an interrupted stage. The Streamer never downloads the archive. Desired broadcast state and the cursor persist; canonical identity is deterministic, unlike ambient's fresh run identity.

## Boundaries and inspection

- With `STORY_DECISION_BRANCHES=2`, text look-ahead is limited to one block; public voting/winner promotion is not implemented.
- `STORY_INTERNAL_CANDIDATES` currently validates configuration only; it creates no candidate media or FIFO work.
- The live deployment is single-instance; horizontal scaling needs external fan-out and a provider-connector leader.

Use `GET /api/admin/broadcasts/:channelId` to inspect desired state, mode, session schedule/status, active session, queue jobs, and safe streamer status. `GET /api/channels/:channelId/playback` provides token-free viewer playback state.

## Product and economic rationale

Session mode gives viewers a time-bound canonical episode: a reason to return
at a known time, shared continuity with other viewers, and a durable story that
can be resumed or replayed. It supports appointment viewing and community
habits more directly than ambient mode.

For the business, that can create premium-event, sponsorship, and community
opportunities, while the durable episode becomes a reusable content asset for
replays, clips, future narrative context, and any later catalog offering. The
implementation's durable blocks, media archives, queue receipts, and resumable
cursor are what make that reuse reliable.

Session mode costs more per episode than ambient because it archives canonical
image/audio, persists delivery metadata, and may perform recovery uploads in
addition to generation and streaming:

```text
session cost / episode
  = text + image + optional TTS + streaming/queue infrastructure
  + durable image/audio storage + archive egress/recovery + database persistence
```

Those costs can be amortized across live viewers, replay views, clips, and
future reuse of the canonical catalog. Like ambient, a single generated stream
serves concurrent viewers with roughly fixed generation cost, so economics
improve with audience concurrency. The scheduled pre-roll, bounded refill,
and image-only fallback protect service continuity and provider spend; they do
not by themselves create revenue.

This repository currently implements no billing, subscription, advertising, or
sponsorship workflow, and its available price metadata is `$0`. Provider
prices, actual generation cadence, media sizes, viewer concurrency, HLS
delivery cost, and retention policy are also absent, so it cannot produce a
reliable dollar-level unit-economics calculation yet.

## Source files

- `server/broadcast/coordinator.ts` — session transitions, pre-roll, cursor, staging, release, and recovery.
- `server/broadcast/media-slots.ts` — canonical media and archive preparation.
- `server/blocks/ai.ts` — RAG/PX context and ordered text windows.
- [Batched story generation](batched-story-generation.md) — batching policy.
- [Ambient context and generation](ambient-context-generation.md) — the non-canonical path.
