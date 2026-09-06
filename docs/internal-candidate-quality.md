# Internal Candidate Quality Selection

> Status: unimplemented. This describes a separate future capability and does
> not enable public branching or alter current playback behavior.

## Purpose

Internal candidates generate alternative hidden versions of one next story
beat, then select the strongest version before it becomes canonical. They are
not viewer-visible choices and must never enter FIFO playback until selected.

## Configuration

`STORY_INTERNAL_CANDIDATES` is independent of `STORY_DECISION_BRANCHES`.

| Value | Effective behavior |
| --- | --- |
| empty or `0` | Disabled. No candidate generation, ranking, or speculative media. |
| `2`–`4` | Generate that many hidden alternatives when an eligible gate fires. |
| other | Server startup fails. |

Log the raw value, effective mode, gate reason, candidate count, ranking result,
discarded count, and any provider-budget or capacity decision.

## Eligibility gates

The capability is considered only when `STORY_INTERNAL_CANDIDATES` is enabled,
the provider budget window is healthy, and ordinary prepared-slot playback
capacity is safe.

### Ambient mode

- Arc cadence: every 4–5 ambient blocks.
- Audience-signal moment: elevated viewer participation or relevant live-chat
  activity according to a documented threshold.

### Session mode

- Arc cadence: every 4–5 canonical blocks.
- Audience-signal moment: elevated viewer participation or relevant live-chat
  activity according to a documented threshold.
- High-stakes narrative moment: reserved stub. No implementation or automatic
  detection is permitted until its event taxonomy and thresholds are decided.

## Capacity rule

Prepared-slot queue capacity is never filled by internal candidates. Candidate
text, media, and images may be prepared only from explicit speculative capacity
that remains after all required ordinary canonical/ambient playback slots are
reserved. If no speculative capacity remains, skip candidate generation rather
than delaying, evicting, or consuming ordinary playback work.

An unselected candidate asset remains private and unreleased. It is either
discarded after selection or retained under a documented short-lived cleanup
policy; it cannot be promoted accidentally through normal queue refill.

## Generation and ranking

1. Build one parent RAG/PX context.
2. Use `NarrativeEngine.generateBlocksBatch` to fan out hidden alternatives
   from that same parent context.
3. Generate candidate images ahead of selection only when speculative capacity
   and provider budget allow it; image-provider concurrency remains one.
4. Send candidates to a dedicated structured LLM ranker.
5. Rank continuity, character consistency, compelling progression, engagement,
   voice, novelty, and avoidance of premature resolution.
6. Promote only the winner to canonical persistence/staging/release.

The ranker decision and concise structured rationale are retained for
observability. Candidate content and images remain internal.

## Provider budget health

Candidate work is skipped when recent provider telemetry indicates rate limits,
quota exhaustion, repeated timeout/error rates, or a depleted normal playback
buffer. It must resume only after the provider-health window recovers and
ordinary playback capacity remains protected.
