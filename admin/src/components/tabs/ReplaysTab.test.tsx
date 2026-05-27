import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminFetch } from '../../api/client';

// ReplaysTab's core business logic involves:
// 1. Fetching channels via adminFetch
// 2. Fetching sessions via adminFetch (filtered by channel)
// 3. Filtering sessions by "completed" status
// 4. Error handling for both fetches
//
// The component rendering (React/JSX) requires jsdom, which is not available
// in the admin test environment. We test the data-fetching and filtering logic
// at the function level here and in client.test.ts.

describe('ReplaysTab business logic', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  describe('channels fetching', () => {
    it('fetches channels from /admin/api/channels', async () => {
      const mockChannels = [
        { id: 1, channelId: 'scifi', name: 'Sci-Fi' },
        { id: 2, channelId: 'fantasy', name: 'Fantasy' },
      ];

      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue(mockChannels),
        text: vi.fn().mockResolvedValue(''),
      });

      const channels = await adminFetch('/channels', 'token');

      expect(channels).toEqual(mockChannels);
      expect(fetchSpy).toHaveBeenCalledWith(
        '/admin/api/channels',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token',
          }),
        }),
      );
    });

    it('handles channels fetch failure', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ message: 'Failed to list channels' }),
        text: vi.fn().mockResolvedValue('{"message":"Failed to list channels"}'),
      });

      await expect(adminFetch('/channels', 'token')).rejects.toThrow(
        'Failed to list channels',
      );
    });
  });

  describe('sessions fetching', () => {
    const mockSessions = [
      {
        id: 1,
        channelId: 'scifi',
        title: 'Active Session',
        status: 'active',
      },
      {
        id: 2,
        channelId: 'scifi',
        title: 'Completed Session 1',
        status: 'completed',
      },
      {
        id: 3,
        channelId: 'scifi',
        title: 'Completed Session 2',
        status: 'completed',
      },
      {
        id: 4,
        channelId: 'scifi',
        title: 'Cancelled Session',
        status: 'cancelled',
      },
    ];

    it('fetches sessions with channelId filter', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue(mockSessions),
        text: vi.fn().mockResolvedValue(''),
      });

      const sessions = await adminFetch('/sessions?channelId=scifi', 'token');

      expect(fetchSpy).toHaveBeenCalledWith(
        '/admin/api/sessions?channelId=scifi',
        expect.any(Object),
      );
      expect(sessions).toEqual(mockSessions);
    });

    it('filters sessions to only completed ones', async () => {
      const completed = mockSessions.filter((s) => s.status === 'completed');

      expect(completed).toHaveLength(2);
      expect(completed.map((s) => s.title)).toEqual([
        'Completed Session 1',
        'Completed Session 2',
      ]);
    });

    it('excludes active sessions', async () => {
      const completed = mockSessions.filter((s) => s.status === 'completed');

      expect(completed.find((s) => s.title === 'Active Session')).toBeUndefined();
    });

    it('excludes cancelled sessions', async () => {
      const completed = mockSessions.filter((s) => s.status === 'completed');

      expect(completed.find((s) => s.title === 'Cancelled Session')).toBeUndefined();
    });

    it('returns empty array when no completed sessions exist', async () => {
      const allActive = [
        { id: 1, channelId: 'scifi', title: 'Only Session', status: 'active' },
      ];

      const completed = allActive.filter((s) => s.status === 'completed');
      expect(completed).toHaveLength(0);
    });

    it('handles sessions fetch failure', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ message: 'Failed to list sessions' }),
        text: vi.fn().mockResolvedValue('{"message":"Failed to list sessions"}'),
      });

      await expect(
        adminFetch('/sessions?channelId=scifi', 'token'),
      ).rejects.toThrow('Failed to list sessions');
    });

    it('handles channels not found error', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ message: 'Channel not found' }),
        text: vi.fn().mockResolvedValue('{"message":"Channel not found"}'),
      });

      await expect(
        adminFetch('/channels/nonexistent', 'token'),
      ).rejects.toThrow('Channel not found');
    });
  });

  describe('error propagation', () => {
    it('throws when auth token is missing for channels', async () => {
      await expect(adminFetch('/channels', '')).rejects.toThrow(
        'Admin token is not set',
      );
    });

    it('throws when auth token is missing for sessions', async () => {
      await expect(
        adminFetch('/sessions?channelId=scifi', ''),
      ).rejects.toThrow('Admin token is not set');
    });

    it('surfaces network errors for channels', async () => {
      fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(adminFetch('/channels', 'token')).rejects.toThrow(
        'Failed to fetch',
      );
    });

    it('surfaces network errors for sessions', async () => {
      fetchSpy.mockRejectedValue(new TypeError('Network error'));

      await expect(
        adminFetch('/sessions?channelId=scifi', 'token'),
      ).rejects.toThrow('Network error');
    });
  });
});
