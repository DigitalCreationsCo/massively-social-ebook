import type { SessionStatus } from './schema';

/** Minimal session fields needed for live-window checks. */
export type SessionTimeWindow = {
  scheduledStart: string | Date;
  scheduledEnd: string | Date;
  status?: SessionStatus | string;
};

/**
 * True when the session is in its scheduled run window: start has passed, end has not,
 * and the session is not completed or cancelled.
 */
export function isSessionInLiveWindow(
  session: SessionTimeWindow | null | undefined,
  now: number = Date.now()
): boolean {
  if (!session) return false;
  if (session.status === 'completed' || session.status === 'cancelled') return false;

  const start = new Date(session.scheduledStart).getTime();
  const end = new Date(session.scheduledEnd).getTime();
  return start <= now && end > now;
}

/**
 * Whether the client should show the live session page (/) rather than /upcoming.
 */
export function shouldShowLiveSession(
  sessionStatus: SessionStatus | 'loading',
  activeSession: SessionTimeWindow | null | undefined,
  now: number = Date.now()
): boolean {
  if (sessionStatus === 'loading') return false;
  if (sessionStatus === 'active') return true;
  if (sessionStatus === 'completed' || sessionStatus === 'cancelled') return false;
  return isSessionInLiveWindow(activeSession, now);
}
