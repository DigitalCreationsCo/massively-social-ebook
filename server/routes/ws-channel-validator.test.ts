import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getChannelIdForWs } from './index';

// Mock the logger so we can assert on it without side effects
vi.mock('../logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('getChannelIdForWs', () => {
  let mockWs: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    // Create a minimal WS-like object.  We only need `close`; the real
    // WebSocket constructor tries to open a connection so we avoid it.
    mockWs = { close: vi.fn() };
    vi.clearAllMocks();
  });

  // Helper to create the Map with the correct key-type (WebSocket-like)
  function makeMap(entries: Array<[typeof mockWs, string]> = []) {
    return new Map<typeof mockWs, string>(entries);
  }

  // ── Success path ────────────────────────────────────────────────────

  it('returns the channelId when the WebSocket is registered', () => {
    const clientMap = makeMap([[mockWs, 'scifi']]);

    const result = getChannelIdForWs(mockWs, clientMap);

    expect(result).toBe('scifi');
  });

  it('does NOT close the connection for a registered client', () => {
    const clientMap = makeMap([[mockWs, 'fantasy']]);

    getChannelIdForWs(mockWs, clientMap);

    expect(mockWs.close).not.toHaveBeenCalled();
  });

  // ── Failure path: unregistered client ───────────────────────────────

  it('returns null when the WebSocket is NOT registered', () => {
    const clientMap = makeMap(); // empty map

    const result = getChannelIdForWs(mockWs, clientMap);

    expect(result).toBeNull();
  });

  it('closes the connection when the WebSocket is NOT registered', () => {
    const clientMap = makeMap();

    getChannelIdForWs(mockWs, clientMap);

    expect(mockWs.close).toHaveBeenCalledWith(4000, 'Not registered');
  });

  it('logs a warning when the WebSocket is NOT registered', async () => {
    const { logger } = await import('../logger');
    const clientMap = makeMap();

    getChannelIdForWs(mockWs, clientMap);

    expect(logger.warn).toHaveBeenCalledWith(
      'WebSocket message from unregistered client',
      'ws',
    );
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  it('handles a WebSocket that was removed from the map after registration', () => {
    const clientMap = makeMap([[mockWs, 'scifi']]);

    // Client disconnects — entry is removed
    clientMap.delete(mockWs);

    const result = getChannelIdForWs(mockWs, clientMap);

    expect(result).toBeNull();
    expect(mockWs.close).toHaveBeenCalledWith(4000, 'Not registered');
  });

  it('handles a null/undefined value in the map', () => {
    const clientMap = new Map<typeof mockWs, string>();
    clientMap.set(mockWs, undefined as unknown as string);

    const result = getChannelIdForWs(mockWs, clientMap);

    // undefined is falsy, so it's treated as unregistered
    expect(result).toBeNull();
    expect(mockWs.close).toHaveBeenCalled();
  });

  it('distinguishes between different WebSocket instances', () => {
    const wsA = { close: vi.fn() };
    const wsB = { close: vi.fn() };
    const clientMap = new Map<typeof mockWs, string>();
    clientMap.set(wsA, 'scifi');
    clientMap.set(wsB, 'fantasy');

    // wsA is registered
    expect(getChannelIdForWs(wsA, clientMap)).toBe('scifi');

    // A third, unregistered WS
    const wsC = { close: vi.fn() };
    expect(getChannelIdForWs(wsC, clientMap)).toBeNull();
  });

  it('does not mutate the map on validation failure', () => {
    const clientMap = makeMap([[mockWs, 'scifi']]);

    // Validate an unknown WS
    const unknownWs = { close: vi.fn() };
    getChannelIdForWs(unknownWs, clientMap);

    // Original mapping is intact
    expect(clientMap.get(mockWs)).toBe('scifi');
    expect(clientMap.size).toBe(1);
  });
});
