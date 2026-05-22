import { describe, it, expect } from 'vitest';
import { isSessionInLiveWindow, shouldShowLiveSession } from './session';

describe('isSessionInLiveWindow', () => {
  const now = Date.parse('2026-05-21T18:00:00.000Z');

  it('returns true when start is in the past and end is in the future', () => {
    expect(
      isSessionInLiveWindow(
        {
          scheduledStart: '2026-05-21T17:55:00.000Z',
          scheduledEnd: '2026-05-21T18:25:00.000Z',
          status: 'scheduled',
        },
        now
      )
    ).toBe(true);
  });

  it('returns false before scheduled start', () => {
    expect(
      isSessionInLiveWindow(
        {
          scheduledStart: '2026-05-21T18:10:00.000Z',
          scheduledEnd: '2026-05-21T18:40:00.000Z',
          status: 'scheduled',
        },
        now
      )
    ).toBe(false);
  });

  it('returns false after scheduled end', () => {
    expect(
      isSessionInLiveWindow(
        {
          scheduledStart: '2026-05-21T17:00:00.000Z',
          scheduledEnd: '2026-05-21T17:30:00.000Z',
          status: 'scheduled',
        },
        now
      )
    ).toBe(false);
  });

  it('returns false for completed or cancelled sessions', () => {
    expect(
      isSessionInLiveWindow(
        {
          scheduledStart: '2026-05-21T17:55:00.000Z',
          scheduledEnd: '2026-05-21T18:25:00.000Z',
          status: 'completed',
        },
        now
      )
    ).toBe(false);
  });
});

describe('shouldShowLiveSession', () => {
  const liveSession = {
    scheduledStart: new Date(Date.now() - 60_000).toISOString(),
    scheduledEnd: new Date(Date.now() + 30 * 60_000).toISOString(),
    status: 'scheduled' as const,
  };

  it('returns true for active status', () => {
    expect(shouldShowLiveSession('active', liveSession)).toBe(true);
  });

  it('returns true for scheduled status inside the live window', () => {
    expect(shouldShowLiveSession('scheduled', liveSession)).toBe(true);
  });

  it('returns false for scheduled status before the window', () => {
    const future = {
      scheduledStart: new Date(Date.now() + 60 * 60_000).toISOString(),
      scheduledEnd: new Date(Date.now() + 90 * 60_000).toISOString(),
      status: 'scheduled' as const,
    };
    expect(shouldShowLiveSession('scheduled', future)).toBe(false);
  });

  it('returns false when loading or completed', () => {
    expect(shouldShowLiveSession('loading', liveSession)).toBe(false);
    expect(shouldShowLiveSession('completed', liveSession)).toBe(false);
  });
});
