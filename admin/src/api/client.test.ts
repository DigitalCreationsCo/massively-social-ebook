import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminFetch, getAdminInfo } from './client';

const API_BASE = '/admin/api';

function mockFetch(response: Partial<Response>): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: vi.fn().mockResolvedValue({ data: 'ok' }),
    text: vi.fn().mockResolvedValue(''),
    ...response,
  } as Response);
}

describe('adminFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('auth validation', () => {
    it('throws if token is undefined', async () => {
      await expect(adminFetch('/test', undefined)).rejects.toThrow(
        'Admin token is not set',
      );
    });

    it('throws if token is empty string', async () => {
      await expect(adminFetch('/test', '')).rejects.toThrow(
        'Admin token is not set',
      );
    });

    it('throws before making any fetch call when token is missing', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await expect(adminFetch('/test', '')).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('successful responses', () => {
    it('returns parsed JSON for a 200 response', async () => {
      mockFetch({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ id: 1, name: 'test' }),
      });

      const result = await adminFetch<{ id: number; name: string }>(
        '/items',
        'valid-token',
      );
      expect(result).toEqual({ id: 1, name: 'test' });
    });

    it('sends Authorization header with Bearer token', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue(''),
      });
      globalThis.fetch = fetchSpy;

      await adminFetch('/items', 'my-secret-token');

      expect(fetchSpy).toHaveBeenCalledWith(
        `${API_BASE}/items`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-secret-token',
          }),
        }),
      );
    });

    it('sends Content-Type: application/json by default', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue(''),
      });
      globalThis.fetch = fetchSpy;

      await adminFetch('/items', 'token');

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('merges custom headers with defaults', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue(''),
      });
      globalThis.fetch = fetchSpy;

      await adminFetch('/items', 'token', {
        headers: { 'X-Custom': 'custom-value' },
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer token',
            'X-Custom': 'custom-value',
          }),
        }),
      );
    });

    it('prepends /admin/api to the endpoint', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue(''),
      });
      globalThis.fetch = fetchSpy;

      await adminFetch('/sessions', 'token');

      expect(fetchSpy).toHaveBeenCalledWith(
        '/admin/api/sessions',
        expect.any(Object),
      );
    });
  });

  describe('HTTP error responses', () => {
    it('throws with error message from JSON body', async () => {
      mockFetch({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ message: 'Bad request: missing field' }),
        text: vi.fn().mockResolvedValue('{"message":"Bad request: missing field"}'),
      });

      await expect(
        adminFetch('/items', 'token'),
      ).rejects.toThrow('Bad request: missing field');
    });

    it('throws with HTTP status when body is empty', async () => {
      mockFetch({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
        text: vi.fn().mockResolvedValue(''),
      });

      await expect(
        adminFetch('/items', 'token'),
      ).rejects.toThrow('HTTP 500');
    });

    it('throws with raw text body when JSON parsing fails', async () => {
      mockFetch({
        ok: false,
        status: 503,
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
        text: vi.fn().mockResolvedValue('Service Unavailable'),
      });

      await expect(
        adminFetch('/items', 'token'),
      ).rejects.toThrow('Service Unavailable');
    });

    it('throws with raw body text even if it is whitespace only', async () => {
      mockFetch({
        ok: false,
        status: 403,
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
        text: vi.fn().mockResolvedValue('   '),
      });

      // '   ' is truthy, so it is used as the error message (not a fallback to HTTP 403)
      await expect(
        adminFetch('/items', 'token'),
      ).rejects.toThrow('   ');
    });

    it('throws with HTTP status when error JSON lacks message field', async () => {
      mockFetch({
        ok: false,
        status: 422,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ error: 'Validation failed', code: 422 }),
        text: vi.fn().mockResolvedValue('{"error":"Validation failed","code":422}'),
      });

      // The text is used since JSON parse succeeds but message property is missing
      await expect(
        adminFetch('/items', 'token'),
      ).rejects.toThrow(/(Validation failed|HTTP 422)/);
    });
  });

  describe('non-JSON response guard', () => {
    it('throws descriptive error when response is HTML', async () => {
      mockFetch({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
        text: vi.fn().mockResolvedValue('<!DOCTYPE html><html>...'),
      });

      await expect(
        adminFetch('/replays/1/render', 'token'),
      ).rejects.toThrow(
        'Expected JSON response from /replays/1/render but got text/html',
      );
    });

    it('throws descriptive error when content-type is missing', async () => {
      mockFetch({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
        text: vi.fn().mockResolvedValue('not json at all'),
      });

      await expect(
        adminFetch('/data', 'token'),
      ).rejects.toThrow(
        'Expected JSON response from /data but got ',
      );
    });

    it('does NOT throw when content-type is application/json with charset', async () => {
      mockFetch({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
        json: vi.fn().mockResolvedValue({ success: true }),
        text: vi.fn().mockResolvedValue('{"success":true}'),
      });

      const result = await adminFetch('/items', 'token');
      expect(result).toEqual({ success: true });
    });
  });

  describe('204 No Content', () => {
    it('returns undefined for 204 response', async () => {
      mockFetch({
        ok: true,
        status: 204,
        headers: new Headers({}),
        json: vi.fn().mockRejectedValue(new Error('No content')),
        text: vi.fn().mockResolvedValue(''),
      });

      const result = await adminFetch('/delete/1', 'token');
      expect(result).toBeUndefined();
    });
  });

  describe('network errors', () => {
    it('propagates fetch network errors', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new TypeError('Failed to fetch'),
      );

      await expect(
        adminFetch('/items', 'token'),
      ).rejects.toThrow('Failed to fetch');
    });

    it('propagates DNS errors', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new TypeError('fetch failed: getaddrinfo ENOTFOUND'),
      );

      await expect(
        adminFetch('/items', 'token'),
      ).rejects.toThrow('getaddrinfo ENOTFOUND');
    });
  });

  describe('request options passthrough', () => {
    it('passes method option to fetch', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue(''),
      });
      globalThis.fetch = fetchSpy;

      await adminFetch('/replays/1/render', 'token', { method: 'POST' });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('passes body option to fetch', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue(''),
      });
      globalThis.fetch = fetchSpy;
      const body = JSON.stringify({ name: 'test' });

      await adminFetch('/items', 'token', {
        method: 'POST',
        body,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body }),
      );
    });
  });

  describe('getAdminInfo', () => {
    it('calls adminFetch with /info endpoint', async () => {
      const mockInfo = {
        database: { name: 'test', host: 'localhost', connected: true },
        version: '1.0.0',
      };

      const spy = vi.spyOn(globalThis, 'fetch');
      spy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue(mockInfo),
        text: vi.fn().mockResolvedValue(''),
      });

      const result = await getAdminInfo('test-token');

      expect(result).toEqual(mockInfo);
      expect(spy).toHaveBeenCalledWith(
        '/admin/api/info',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('propagates token validation error', async () => {
      await expect(getAdminInfo('')).rejects.toThrow(
        'Admin token is not set',
      );
    });
  });
});
