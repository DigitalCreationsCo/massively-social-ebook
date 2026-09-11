# Ambient Context and Generation

## Scope

Ambient material is the live broadcast's disposable, non-canonical interlude between scheduled sessions. It is never persisted as a story block, never advances canonical continuity, and can be abandoned on restart or at session pre-roll. This guide describes the live `BroadcastCoordinator`/`AmbientPipeline` path, not older replay or game-loop code.

## Seed and context

The coordinator uses, in order, the last persisted canonical block's content, the next session description, or an empty string as the ambient seed. Every ambient text window uses that same seed: ambient material follows the established story but does not change it.

`NarrativeEngine` builds a shared context from that seed. It combines RAG's chronological/relevant blocks and active lore with PX enrichment and the stable story-authoring instructions. RAG database access is globally throttled and duplicate reads within a window are promise-deduplicated. Required PX manifests are validated and cached at startup; a later PX outage may still return those cached profiles. PX failure is complementary—it does not discard useful RAG context.

The single-block context path has a 12-second deadline. On failure it prompts from the seed alone and logs the reason. A failed batch is logged and causes the ambient worker to fall back to a single-block text attempt.

Image references come only from nested `entity.representations`: selection prefers `character_sheet`, then `portrait`, uses at most one valid representation per entity, deduplicates by content hash, and observes the engine limit. The server presigns and fetches references just in time; signed URLs are neither sent to the image model nor logged.

## Ordered text and concurrent media

Up to five ambient workers claim text in order from a shared structured window of up to five blocks:

```text
seed -> one RAG/PX context snapshot -> one ordered text response
     -> ordered text claims -> concurrent image/TTS work -> ordered FIFO turns
```

The text model must return exactly the requested number of short chronological blocks: the first continues the seed and every following block continues the prior item in the same response. The response is schema-validated. Workers may finish media work out of order, but turns commit in their reserved generation order. Split narration segments remain contiguous, so later media cannot overtake earlier content in FIFO.

## Media and fallback policy

Each turn generates image and narration concurrently. Text and image attempts retry up to three times with bounded delays. Narration is best-effort and defaults to one attempt; an image succeeds as an image-only turn if TTS does not. If new-image generation fails, the service tries the newest canonical archived image, then a random archived channel image. A turn without an image is skipped and lone audio is discarded.

During image-provider cooldown, ambient generation is skipped so the player can hold its current frame rather than receive repeated fallback visuals. Image-only slots last `BROADCAST_IMAGE_ONLY_DURATION_SECONDS` (15 seconds by default); narrated slots last the longer of TTS duration and `BROADCAST_IMAGE_DURATION_SECONDS` (12 seconds by default).

Ambient bytes remain local until eligible for release. They are not archived or durably pre-staged, which prevents orphaned non-playable entries after a restart or mode change.

## Backpressure, release, and lifecycle

`AmbientPipeline` bounds prepared work by ready duration (60 seconds), bytes (50 MiB), concurrent generation (5), and outstanding distinct visuals in the FIFO (5) by default. Validated `BROADCAST_AMBIENT_*` settings tune these limits. It stages image and optional audio with idempotent keys, atomically releases the slot, then monitors terminal job state. A queue-full response pauses ambient admission for 30 seconds.

Before release, the pipeline checks whether the reserved FIFO duration plus a safety margin would cross the next session start. It holds a turn if it would. Three minutes before a session, the coordinator aborts and awaits ambient work; already released FIFO work is allowed to drain because the queue has no safe retraction operation.

Streamer health and authenticated playback are required before ambient work begins. An outage changes mode to `waiting_for_streamer`, cancels ambient work, and retries after 2, 5, 10, then 30 seconds. A broadcast restart creates a new ambient run ID and run-scoped idempotency sequence.

## Product and economic rationale

Ambient mode makes the channel continuously watchable. For a viewer, that
avoids a dead/offline experience and makes casual discovery possible at any
time. For the business, it creates top-of-funnel inventory, potential watch
time, and a smooth route from a casual visit into a scheduled canonical
episode.

Its trade-off is an ongoing baseline cost: text, image, optional TTS, and
streaming/queue work continue between sessions. The implementation limits that
exposure through bounded preparation, a provider-cooldown stop, queue-full
backoff, and no durable archive of ambient media. It also avoids repeated
fallback visuals when the image provider cannot accept work.

Ambient cost is largely fixed per generated live hour, rather than per viewer:

```text
ambient cost / live hour
  = text generation + image generation + optional TTS
  + streaming/queue infrastructure + transient compute/storage
```

That makes concurrent viewing economically important: the same generated
stream can serve many viewers while generation cost stays roughly flat. At low
concurrency, continuous ambient can have a high cost per viewer-hour. A
reasonable operating policy is continuous ambient for discovery-critical
channels and throttled, paused, or simpler ambient for low-demand channels.

This repository does not yet implement subscriptions, advertising, sponsorship
sales, or other monetization, and it does not contain provider pricing or the
usage data needed for a dollar estimate. The business value above is therefore
a product hypothesis, not recorded revenue.

## Source files

- `server/broadcast/coordinator.ts` — seed selection, text claims, ordering, and session boundaries.
- `server/broadcast/ambient-pipeline.ts` — limits, FIFO safety, and job monitoring.
- `server/blocks/ai.ts` — context construction and structured text windows.
- `server/broadcast/media-slots.ts` — media retries and fallbacks.
- [Session mode](session-mode.md) — the durable canonical path.
