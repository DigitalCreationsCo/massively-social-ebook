# Session Scheduler & Lifecycle

## Overview

This document describes how sessions are scheduled, created, and transitioned to active state.

## Scheduler Architecture

The scheduler runs two loops:

| Loop | Frequency | Purpose |
|------|-----------|---------|
| **Notification Loop** | Every 30 seconds | Process due schedules, complete expired sessions, handle notifications |
| **Seeding Loop** | Every 30 minutes | Ensure sessions exist within 7-day lookahead window |

### Key Constants

- `LOOP_INTERVAL_MS = 30 * 1000` (30 seconds)
- `SEEDING_INTERVAL_MS = 30 * 60 * 1000` (30 minutes)
- `SESSION_LOOKAHEAD_DAYS = 7`
- `LOBBY_DELAY_MS = 3 * 60 * 1000` (3 minutes - when session enters "gathering" phase)

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

### Automatic (Game Loop)

The game loop runs every **1 second** and automatically starts sessions when they're within the **3-minute lobby window**:

**Server logic** (`server/routes/index.ts`):
```typescript
// In handleGameLoopTick()
if (now >= next.scheduledStart.getTime() - 3 * 60 * 1000) {
  await startSessionForChannelId(channelId, next, broadcast);
}
```

This means:
1. Session enters "gathering" phase 3 minutes before scheduled start
2. Session transitions to `active` status at scheduled start time
3. WebSocket broadcasts `SESSION_STATUS` message to all connected clients

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