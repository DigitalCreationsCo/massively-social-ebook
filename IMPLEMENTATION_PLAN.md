# Implementation Plan: 25th Chapter Game Loop Modernization

## Overview

Replace the global `setInterval(1000)` poll loop with a presence-triggered,
per-channel tick engine (`RealtimeEngine` from `@portalshq/runtime-core`) and
replace the in-memory `StateCache` with simple, lightweight `Map` structures
within the application to avoid unnecessary cross-workspace library
dependencies for trivial functionality.

---

## Phase 1 — RealtimeEngine Integration ✅ COMPLETED

**Goal**: Wire the `RealtimeEngine` (presence-triggered per-channel tick engine)
into the application, replacing the global `setInterval(1000)` that checked ALL
channels every second.

### Key Changes
1. **Symlink setup**: `node_modules/@portalshq/runtime-core` symlinked to `portals-cloud/packages/runtime-core`.
2. **Library cleanup**: Removed unused `StateCache` and `SessionOrchestrator` from `portals-cloud` library to ensure clean exports.
3. **App integration**: `server/routes/index.ts` imports `RealtimeEngine` directly from `@portalshq/runtime-core`.

---

## Phase 2 — StateCache Removal ✅ COMPLETED

**Goal**: Replace the local `StateCache` with simple `Map`-based in-memory
storage within `server/game-loop/channel-tick.ts`.

### Key Changes
1. **Local cache removal**: Removed `server/game-loop/state-cache.ts` and `server/game-loop/realtime-engine.ts`.
2. **App refactor**: `channel-tick.ts` now manages state via `new Map()` instances.
3. **API preserved**: `clearChannelCache()` retains the same signature for test compatibility.

---

---

## Phase 3 — Session Lifecycle Consolidation 📋 PLANNED

**Goal**: Move session lifecycle logic from routes/index.ts into a dedicated
lifecycle manager, reducing the `registerRoutes` function size and isolating
session state transitions.

### Proposed approach
- Create `server/game-loop/session-lifecycle.ts` with a `SessionLifecycle` class
  that owns the `RealtimeEngine` instance
- Extract WS connection setup into a separate function (or class)
- The lifecycle manager handles: start, end, pause, resume
- Keeps `registerRoutes` focused on HTTP/WS route registration

### Files to create
- `server/game-loop/session-lifecycle.ts`

### Files to modify
- `server/routes/index.ts`

---

## Phase 4 — Lock-Free Phase Transitions 📋 PLANNED

**Goal**: Remove distributed advisory locks (`tryAcquireGameLock` /
`releaseGameLock`) in favor of optimistic concurrency or single-writer
guarantees.

### Proposed approach
- Use PostgreSQL advisory locks only for multi-instance deployments
- For single-instance (current), use in-memory mutexes per channel
- Simplify the lock/unlock pattern to reduce boilerplate
- Consider: is the lock still needed once the RealtimeEngine ensures only one
  process ticks a given channel?

### Files to modify
- `server/game-loop/channel-tick.ts` — lock acquisition calls
- `server/storage.ts` — lock implementation

---

## Phase 5 — Client-Side Timer Synchronization 📋 PLANNED

**Goal**: Improve the heartbeat broadcast to include server-wall-clock offsets
so client timers stay in sync without drift.

### Proposed approach
- Add `serverTime` field to `SYNC_STATE` payload
- Client computes offset from local clock and adjusts countdown timers
- Eliminates visible jumps when client clock differs from server clock

### Files to modify
- `server/game-loop/channel-tick.ts` — heartbeat payload
- Client-side timer components

---

## Phase 6 — Channel-Watcher Enhancement 📋 PLANNED

**Goal**: Replace the 30-second `setInterval` watcher with a more efficient
wake-on-schedule mechanism.

### Proposed approach
- Use a sorted priority queue (or `setTimeout` chain) to wake up only when
  a session's scheduled start time is approaching
- Eliminates the 30-second poll entirely
- Falls back to polling if the queue is empty

### Files to create
- `server/game-loop/schedule-watcher.ts`

### Files to modify
- `server/routes/index.ts` — remove watcher setInterval

---

## Key Technical Decisions

1. **RealtimeEngine lives in the app, not portals-cloud**
   - portals-cloud is a separate workspace not listed as a dependency
   - Duplicated and adapted locally to avoid cross-workspace dependency

2. **StateCache has no TTL**
   - A TTL shorter than the tick interval silently defeats the cache
   - Entries are authoritative until `invalidate()` or `set()`
   - Swappable for Redis-backed implementation behind the same interface

3. **Two-tier approach for channel ticking**
   - RealtimeEngine handles per-channel 1s ticking when viewers are present
   - 30s background watcher handles session starts for channels with no viewers
   - Both delegate to the same `handleChannelTick` function

4. **Backward compatibility**
   - `handleGameLoopTick` retains exact signature `(now, broadcast) => Promise<void>`
   - Tests import from `./routes/index` and `../routes` — both paths work
   - `clearChannelCache`, `computeDecisionEndsAt`, and all timing constants
     remain exported

5. **Once-live, always-live**
   - A running session does NOT stop when the last viewer disconnects
   - Later viewers always join a consistent, in-progress state
   - `removeViewer` only cancels pending recheck timers, never running timers

---

## Schema Alignment Notes

| Component | DB Table | Cache | Notes |
|-----------|----------|-------|-------|
| Channel state | `channel_states` | `stateCache` | Write-through on upsert |
| Block | `blocks` | `blockCache` | Write-through on create |
| Session | `sessions` | — | Queried on-demand |
| Vote | `votes` | — | Queried on-demand |
| Pending block | `pending_blocks` | — | Written by pregenerate, read once |

---

## Client Migration Path

1. **No immediate changes needed** — `SYNC_STATE` payload structure is unchanged
2. Future: add `serverTime` field for drift-free countdowns (Phase 5)
3. Future: consider sending `SESSION_STATUS` on session lifecycle events
   (already done for start/complete)

---

## Test Coverage

| Test File | Tests | Status |
|-----------|-------|--------|
| `server/game-loop.test.ts` | 26 | ✅ Passing |
| `server/sessions/game-loop-start.test.ts` | 4 | ✅ Passing |
| Other tests | 251 passing, 18 failing | Pre-existing failures (UI timers, auth, env vars) |
