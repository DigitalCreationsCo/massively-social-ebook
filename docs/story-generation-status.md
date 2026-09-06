# Story generation delivery status

Last updated: 2026-09-06

## Shipped and active

- RAG database operations use a global concurrency limit to protect the shared pool.
- PX enrichment is complementary (`continue`): a PX failure does not discard RAG context.
- Context fallback errors are recorded in prompt-log JSON and structured app logs.
- Embeddings are opt-in only (`useEmbedding === true`).
- Playback holds the last video frame during reconnects; image quota failures fall back to archived visuals.
- `STORY_DECISION_BRANCHES` and `STORY_INTERNAL_CANDIDATES` are startup validated. Public choices are disabled unless the public value is exactly `2`.
- The player uses the full timed-voting `DecisionPhase` presentation; without a server voting phase it remains a reading-progress overlay.
- Canonical text windows are available through `generateCanonicalStoryWindow`: one RAG/PX retrieval snapshot produces an ordered, dependent chain of up to five text blocks. It produces no media and reserves no playback slots.
- The live broadcast coordinator consumes canonical windows only to satisfy its current ordinary refill deficit, capped at three texts. It persists, generates media for, and stages each admitted canonical turn in order.
- Image-provider admission is active for all image generation: one request at a time, with at least 15 seconds between image starts and a 90-second cooldown after quota/rate-limit failures. Existing archive-image fallback continues to handle rejected work.

## In progress

- Unit and integration coverage for admission, capacity, recovery, and provider-failure behavior.

## Not implemented

- Public voting lifecycle: cadence, vote submission/tally broadcast, deadline, winner promotion, branch cleanup, and restart recovery.
- Public A/B fan-out through `engine.generateBlocksBatch`; unselected branch media must never enter FIFO playback.
- Internal candidates. `STORY_INTERNAL_CANDIDATES` validates configuration only; it creates no generation, images, ranking, or prepared slots.

## Capacity invariants

- The prepared-slot queue is reserved for canonical content that can be released. Batch text/image work never reserves or fills it speculatively.
- Candidate or branch media may be generated only in separate speculative capacity after canonical capacity is reserved; this is not implemented yet.
- Image provider work runs at concurrency one. A quota/rate-limit signal opens a cooldown; callers fall back to an already archived visual rather than waiting or retrying into a depleted provider window.
- A canonical text window is consumed strictly in array order. Each text is passed through persistence, media creation, and deterministic block/segment slot staging before the next text is processed; images cannot be attached to a different block or released out of canonical order.
