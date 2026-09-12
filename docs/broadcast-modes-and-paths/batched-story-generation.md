# Batched Story Generation

## Purpose

Batch generation protects playback from slow, quota-limited image generation.
Text is produced ahead of consumption, then each generated block immediately
creates a separately scheduled image/media job. Staging and FIFO release do
not wait for new text or image generation.

## Generation modes

### Ambient mode

Ambient turns are non-canonical interludes. They may be generated with
`NarrativeEngine.generateBlocksBatch` because each request shares the latest
canonical context and does not change canonical continuity.

Ambient generation fills only ordinary prepared playback capacity. It must not
release out of sequence or delay a scheduled canonical episode.

### Canonical session mode

Dependent canonical blocks must remain chronological. `generateBlocksBatch`
cannot directly produce a linear chain because it builds all retrieval contexts
before any draft exists.

The default future transport is a bounded structured sequential window:

1. Retrieve RAG context and PX enrichment once.
2. Ask the text model for an ordered array of blocks, capped by available
   ordinary prepared-slot capacity.
3. Instruct the model that every subsequent item is a direct chronological
   continuation of the earlier items in the same output.
4. Validate and checkpoint every item separately.
5. Queue image/media preparation per checkpointed item.

The prompt must reuse the stable rules from `storyblock.prompt.ts`, adding only
the sequential-window contract: preserve character memory, consequences,
continuity, escalating engagement, and strict chronological order.

The fallback transport is a sequential tool loop: validate one block, append
it to a mutable ledger, then request the next. Use it after structured-window
validation failure or when a provider cannot reliably return ordered output.

## Image and queue policy

- Image jobs are dispatched once their block prompt and references exist.
- Provider image calls use the provider-safe concurrency limit of one.
- On a provider quota/rate-limit failure, reuse the latest archived canonical
  image before considering any historical fallback.
- Staged/released playback slots reserve the ordinary queue capacity. Text,
  image, staging, release, and monitoring are independently supervised tasks.
- The viewer player holds the last decoded frame while HLS waits; this is
  presentation protection, not a substitute for queue refill.

## Public decisions

`STORY_DECISION_BRANCHES` is the only public-decision setting.

| Value | Effective behavior |
| --- | --- |
| empty or `0` | Decisions disabled end-to-end. No decision prompt, public options, pending branches, branch images, or branch UI. |
| `1` | Same as disabled. Log `disabled_single_choice`. |
| `2` | Existing public A/B choices and two pre-generated continuations enabled. |
| other | Server startup fails. |

For a public decision, `generateBlocksBatch` fans out two continuation requests
from the same parent context, one per option. Each branch may generate and
store its image ahead of selection, but an unselected branch is never released
to FIFO playback. Only the selected branch is promoted, staged, and released.

At startup and on each generation run, log the raw value, effective decision
mode, and branch count.
