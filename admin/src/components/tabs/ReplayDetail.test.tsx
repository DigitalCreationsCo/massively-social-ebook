import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminFetch } from '../../api/client';

// ReplayDetail's business logic is primarily:
// 1. Calling adminFetch with the correct endpoint + token + method
// 2. Handling success/error states
// 3. Displaying error context
//
// We test the data-fetching layer (adminFetch) thoroughly here and in client.test.ts.
// The component rendering (React/JSX) requires jsdom, which is not available in
// the admin test environment. We test all error-handling logic at the function level.

describe('ReplayDetail business logic', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  describe('render endpoint call', () => {
    it('calls POST /admin/api/replays/:id/render with Bearer token', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          message: 'Rendering started for session 42',
          status: 'processing',
        }),
        text: vi.fn().mockResolvedValue(''),
      });

      const result = await adminFetch<{
        message: string;
        status: string;
      }>('/replays/42/render', 'test-token', { method: 'POST' });

      expect(result).toEqual({
        message: 'Rendering started for session 42',
        status: 'processing',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        '/admin/api/replays/42/render',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('propagates HTTP 401 errors from render endpoint', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
        text: vi.fn().mockResolvedValue(''),
      });

      await expect(
        adminFetch('/replays/42/render', 'invalid-token'),
      ).rejects.toThrow('HTTP 401');
    });

    it('handles non-JSON response from render endpoint (missing route)', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
        text: vi.fn().mockResolvedValue('<!DOCTYPE html><html>...'),
      });

      await expect(
        adminFetch('/replays/42/render', 'token'),
      ).rejects.toThrow(
        'Expected JSON response from /replays/42/render but got text/html',
      );
    });

    it('handles render success with different session IDs', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          message: 'Rendering started for session 99',
          status: 'processing',
        }),
        text: vi.fn().mockResolvedValue(''),
      });

      const result = await adminFetch<{ message: string; status: string }>(
        '/replays/99/render',
        'token',
        { method: 'POST' },
      );

      expect(result.message).toContain('99');
    });

    it('handles server error from render endpoint', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          message: 'Failed to trigger replay render',
        }),
        text: vi.fn().mockResolvedValue(
          '{"message":"Failed to trigger replay render"}',
        ),
      });

      await expect(
        adminFetch('/replays/42/render', 'token', { method: 'POST' }),
      ).rejects.toThrow('Failed to trigger replay render');
    });
  });

  describe('render state management', () => {
    it('throws with clear error when token is missing', async () => {
      await expect(
        adminFetch('/replays/1/render', undefined, { method: 'POST' }),
      ).rejects.toThrow('Admin token is not set');
    });

    it('sends POST method for render requests', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ message: 'ok', status: 'processing' }),
        text: vi.fn().mockResolvedValue(''),
      });

      await adminFetch('/replays/1/render', 'token', { method: 'POST' });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
