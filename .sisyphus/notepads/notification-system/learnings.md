# Learnings

## Current State
- `UpcomingSession.tsx`: Handles UI and email capture.
- `server/routes.ts`: Has `/api/sessions/reminder` (calendar integration) and `/api/notifications/subscribe` (stub).
- `server/scheduler.ts`: Has cron jobs for seeding and basic notifications.
- `server/ics.ts`: Generates ICS content.
- `use-push-notifications.ts`: Client-side push logic.

## Missing/Incomplete
- `/api/notifications/subscribe` does not persist to DB.
- Missing `GET /api/sessions/:id/ics`.
- Missing `UpcomingSession.test.tsx`.
- Push notifications use hardcoded VAPID key.

## Requirements
- Unified lead/session handling.
- Stateless deterministic window logic (Weekly, Daily, Catch-up, Push).
- Comprehensive testing.

## Notification System Design (New)
- **Stateless Window Logic**: Moving away from cron jobs to a cursor-based approach allows for deterministic event processing and graceful handling of downtime (catch-up).
- **Single Pool Concept**: Unifying all time-based events (notifications, game state changes) into a single stream simplifies the architecture and ensures consistency.
- **Mathematical Rigor**: Using strict inequalities ($T_{last} < T_{target} \le T_{now}$) prevents edge cases like double-firing or missing events.
- **Immediate Catch-up**: Handling server restarts requires checking the validity window ($T_{now} < T_{expire}$) to avoid sending stale notifications.

- Added `system_settings` and `notification_logs` tables to `shared/schema.ts` to support the new deterministic stateless window notification system.
- Used `drizzle-orm/pg-core` for table definitions and `drizzle-zod` for schema generation, consistent with the existing codebase.

## Unified Lead and Session Handling
- Implemented `getUserByEmail` and `updateUserPushToken` in `server/storage.ts` to support user persistence.
- Updated `/api/notifications/subscribe` and `/api/sessions/reminder` to persist users (leads) when they interact with these endpoints.
- Added `GET /api/sessions/:id/ics` to generate and serve ICS calendar files for sessions.
- Updated `server/session-routes.test.ts` to verify the new behavior and ensure existing functionality is preserved.

## Calendar Integration
- Added `generateIcs` static method to `CalendarService` in `server/calendar.ts` to generate standard ICS content.
- This allows users to download calendar events directly without relying on external services for the file generation itself (though Google/Outlook APIs are still used for direct integration).

## Stateless Deterministic Window Logic

- Implemented a stateless deterministic window loop in `server/scheduler.ts` to replace `node-cron`.
- The loop runs every 10 seconds and processes events in the window `(lastProcessed, now]`.
- The cursor `notification_cursor` is stored in `system_settings` table.
- Events are generated dynamically based on session schedules and fixed times (Weekly Briefing, Daily Seeding).
- Idempotency is handled via `notification_logs` table.
- Expiration logic ensures events are skipped if the window is processed too late (e.g. after session start).

## Testing

- Unit tests in `server/scheduler.test.ts` verify the loop logic, event generation, and seeding.
- Mocked `storage` and `setInterval` (via fake timers) to test without side effects.
- Avoided `runAllTimersAsync` with infinite intervals to prevent test timeouts.
