# Session Scheduler & Lifecycle

## Overview

This document describes how sessions are scheduled, created, and transitioned to active state.

## Scheduler Architecture

The scheduler runs two loops (plus `BroadcastCoordinator` live path):

| Loop | Frequency | Purpose | Cursor |
|------|-----------|---------|--------|
| **Fast Loop** | Every 30 seconds | Process `nextRunAt` due schedules, mark `expiredActiveSessions` (`scheduledEnd+5m` grace) | None — idempotent via DB constraints (`23505`) and grace window |
| **Main Loop** | Every 10 minutes | Seed `7-day` lookahead sessions, process notification events (`SESSION_WARNING_5MIN` in `[start+5m,end+5m]` + `WEEKLY_BRIEF`) | `notification_cursor` (`CURSOR_KEY`) — `SEEDING_CURSOR_KEY` reserved, fast loop no longer contends |

Live broadcast channels additionally run `BroadcastCoordinator.produce` tight loop + `RealtimeEngine` 5s presence ticks (`server/broadcast/runtime.ts:70`), with `scheduleRecheckAt: scheduledStart-3m` (`server/broadcast/coordinator.ts:118`, `server/game-loop/channel-tick.ts:channelTickActivate`) for precise pre-roll.

### Key Constants

- `FAST_LOOP_INTERVAL_MS = 30 * 1000` (30 seconds)
- `MAIN_LOOP_INTERVAL_MS = 10 * 60 * 1000` (10 minutes)
- `SESSION_LOOKAHEAD_DAYS = 7`
- `LOBBY_DELAY_MS = 3 * 60 * 1000` (3 minutes - lobby/`gathering`, `START_BEFORE_MS` alias `server/game-loop/channel-tick.ts:39`)
- `READING_SEGMENT_MS = 25_000` (kept app-owned — `runtime-core@0.0.7` has no `TimeCounter`, only `scheduleRecheckAt` `server/game-loop/channel-tick.ts:channelTickActivate`)

## Session Lifecycle

```
scheduled → active → completed
           ↓
        cancelled
```

### Session States

| State | How Set | Description |
|-------|---------|-------------|
| `scheduled` | Scheduler creates session | Session is scheduled for future |
| `active` | Game loop (auto) or API (manual) | Session is running |
| `completed` | Game loop (automatic) | Session end time passed |
| `cancelled` | Admin/API | Session was cancelled |

## How Sessions Become Active

### Automatic — Two paths (reader vs live HLS)

**Reader / on-demand (REST, kept):** `server/game-loop/channel-tick.ts:154 handleChannelTick` runs when invoked (dev `POST /api/debug/sessions/start` `server/routes/index.ts:359` or legacy `handleGameLoopTick` `server/routes/index.ts:624` — now unregistered `docs/server-flowchart.md:259`). Checks `now >= scheduledStart - START_BEFORE_MS` `channel-tick.ts:190` under `tryAcquireGameLock 30s`, then `startSessionForChannelId` (fire-and-forget `batchGenerateBlocks` `blocks/batch-generate.ts:96` if empty, else REST poll `GET /api/blocks/session/:id` `server/routes/index.ts:415`). Realtime-aware: `channelTickActivate(): {scheduleRecheckAt: scheduledStart-3m}` `channel-tick.ts` mirrors `coordinator.ts:118` for `RealtimeEngine` precise timer (ponytail wrapper, no new `TimeCounter`).

**Live HLS (queue, converging core):** `BroadcastCoordinator` `server/broadcast/coordinator.ts:218 produce` tight loop + `RealtimeEngine` 5s (`runtime.ts:70`) presence-driven. `activate()` `coordinator.ts:118` returns `{scheduleRecheckAt: preRoll}` (`PRE_ROLL_MS 3m`), `tick()` `coordinator.ts:124` supervises `produce`. At `preRoll` stages 3 slots (`ensureStagedSlots`), at `scheduledStart` releases serially via `submitSlot` (`stageUpload`+`releaseSlot` `coordinator.ts:850/887`) -> `LiveDelivery` HLS (`runtime.ts:193`).

This means:
1. Session enters `gathering`/`preparing` 3 minutes before scheduled start
2. Session transitions to `active` at `scheduledStart` (`storage.updateSessionStatus:active` `coordinator.ts:536` or `channel-tick.ts:136`)
3. WebSocket broadcasts `SESSION_STATUS` `active`; HLS viewers stream `playbackManifestUrl` `GET /api/channels/:ch/playback` `runtime.ts:193`, readers poll blocks

### Manual (API)

Sessions can also be started manually via:
- `POST /api/sessions/start` (control room / UI)

## Client-Side Behavior

### WebSocket Events

The server broadcasts `SESSION_STATUS` messages when:
- Session becomes active
- Session completes

```typescript
// Server sends:
{
  type: 'SESSION_STATUS',
  payload: { status: 'active', session: { ... } }
}
```

### Handling in useLiveState Hook

The `use-live-state.ts` hook listens for `SESSION_STATUS` messages:

```typescript
else if (message.type === 'SESSION_STATUS') {
  setSessionStatus(payload.status);
  setActiveSession(payload.session);
  if (payload.status === 'active') {
    queryClient.invalidateQueries({ queryKey: [api.sessions.next.path, channelId] });
  }
}
```

### Auto-Redirect Logic

**UpcomingSession.tsx:**
- Watches `sessionStatus` from `useLiveState`
- When `sessionStatus === 'active'`, redirects to `/`

**LiveEbook.tsx:**
- Watches `sessionStatus` from `useLiveState`
- When `sessionStatus === 'scheduled' || sessionStatus === 'completed'`, redirects to `/upcoming`

## Troubleshooting

### Session Not Becoming Active

1. **Check game loop is running**: Server logs should show `[GameLoop] Channel ...: Session entering start window`
2. **Verify 3-minute window**: Sessions start 3 minutes before their scheduled time
3. **Check WebSocket connection**: Clients must be connected to receive status updates
4. **Verify broadcast function**: Ensure `broadcast()` is called when session starts

### Countdown Not Updating

1. **Verify scheduledStart is set**: Check session has `scheduledStart` timestamp
2. **Check useEffect dependency**: `nextSession?.scheduledStart` should trigger timer
3. **Check WebSocket**: Ensure `SESSION_STATUS` messages are being received and processed

### LiveEbook Not Updating

1. **Verify SESSION_STATUS handling**: Check `useLiveState` processes the message
2. **Check query invalidation**: When session becomes active, queries should be invalidated
3. **Check redirect logic**: LiveEbook should redirect to `/upcoming` if session is not active

## Manual Session Creation

When creating a session via control room:

1. Session is created with `status: 'scheduled'`
2. Scheduler won't automatically create duplicates if session already exists
3. Game loop will pick up the session and start it when within the 3-minute window
4. No special timing required - just ensure session start time is in the future