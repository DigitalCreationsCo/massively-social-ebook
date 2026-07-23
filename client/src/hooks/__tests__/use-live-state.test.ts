
import { renderHook, act } from '@testing-library/react';
import { useLiveState } from '../use-live-state';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as ReactQuery from '@tanstack/react-query';
import * as analytics from '@/lib/analytics';

// Mock dependecies
vi.mock('@tanstack/react-query', () => ({
    useQuery: vi.fn(),
    useQueryClient: vi.fn(() => ({
        invalidateQueries: vi.fn(),
        setQueryData: vi.fn(),
    })),
}));

vi.mock('@/lib/analytics', () => ({
    trackEvent: vi.fn(),
    identifyUser: vi.fn(),
}));

const mockToast = vi.fn();
vi.mock('../use-toast', () => ({
    useToast: () => ({ toast: mockToast }),
}));

describe('useLiveState', () => {
    let wsInstance: any;
    const mockQueryClient = {
        invalidateQueries: vi.fn(),
        setQueryData: vi.fn(),
    };

    beforeEach(() => {
        vi.useFakeTimers();
        // Setup default mocks
        (ReactQuery.useQuery as any).mockImplementation((options: any) => {
            if (options.queryKey.includes('/api/sessions/next')) {
                return { data: null, isLoading: false };
            }
            if (options.queryKey.includes('/api/blocks/current')) {
                return { data: { id: 1, content: 'Test block', optionA: {label: 'A'}, optionB: {label: 'B'} }, isLoading: false };
            }
            if (options.queryKey.includes('/api/chat')) {
                return { data: [], isLoading: false };
            }
            return { data: null, isLoading: false };
        });

        (ReactQuery.useQueryClient as any).mockReturnValue(mockQueryClient);
        
        // Mock window.location for WS URL
        Object.defineProperty(window, 'location', {
            value: { protocol: 'http:', host: 'localhost:5001' },
            writable: true
        });
        
        // Mock WebSocket
        class MockWebSocket {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;
            onopen: any = null;
            onmessage: any = null;
            onclose: any = null;
            onerror: any = null;
            readyState: number = 0; // Starts as CONNECTING
            close = vi.fn();
            send = vi.fn();

            constructor() {
                wsInstance = this; setTimeout(() => { this.readyState = 1; if(this.onopen) this.onopen(); }, 0); // Assign the instance to the outer scope
                setTimeout(() => {
                    this.readyState = 1; // Simulate connection opening
                    if (this.onopen) this.onopen();
                }, 100);
            }
        }
        (global as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sets initial state correctly', () => {
        const { result } = renderHook(() => useLiveState('scifi'));
        expect(result.current.macroPhase).toBe('waiting');
        expect(result.current.sessionStatus).toBe('scheduled');
        expect(result.current.wsConnected).toBe(false);
    });

    it('connects via WebSocket and sets wsConnected to true', async () => {
        const { result } = renderHook(() => useLiveState('scifi'));
        await act(async () => {
            vi.runOnlyPendingTimers();
        });
        expect(result.current.wsConnected).toBe(true);
    });

    it('handles SYNC_STATE message and updates timers', async () => {
        const { result } = renderHook(() => useLiveState('scifi'));
        await act(async () => {
            vi.runOnlyPendingTimers(); // Open connection
        });
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({
                    type: 'SYNC_STATE',
                    payload: { timeRemaining: 50000, timeToNextDecision: 120000, initialTimeToNextDecision: 180000 }
                })
            });
        });

    });
    
    it('handles CHAT_MESSAGE and updates query data', async () => {
        renderHook(() => useLiveState('scifi'));
        await act(async () => {
            vi.runOnlyPendingTimers(); // Open connection
        });
        const chatPayload = { id: 1, username: 'test', text: 'hello' };
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ type: 'CHAT_MESSAGE', payload: chatPayload })
            });
        });
        expect(mockQueryClient.setQueryData).toHaveBeenCalledWith(['/api/chat', 'scifi'], expect.any(Function));
    });

    it('handles REACTION_RECEIVED and updates reactions state', async () => {
        const { result } = renderHook(() => useLiveState('scifi'));
        await act(async () => { vi.runOnlyPendingTimers(); });
        const reactionPayload = { id: 1, emoji: '👍' };
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ type: 'REACTION_RECEIVED', payload: reactionPayload })
            });
        });
        expect(result.current.reactions).toContainEqual(reactionPayload);
    });

    it('submits chat message and optimistically updates', async () => {
        const { result } = renderHook(() => useLiveState('scifi'));
        await act(async () => { vi.runOnlyPendingTimers(); });

        act(() => {
            result.current.submitChat('Hello world');
        });

    expect(wsInstance.send).toHaveBeenCalledWith(expect.stringContaining('SUBMIT_CHAT'));
    expect(mockQueryClient.setQueryData).toHaveBeenCalled();
    expect(analytics.trackEvent).toHaveBeenCalledWith('Chat Message Sent', expect.any(Object));
  });

  it('replaces optimistic message with server-confirmed message (no duplicates)', async () => {
    // Deterministic clientId so we can simulate the server echo
    const MOCK_UUID = 'test-uuid-0000-0000-000000000000';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(MOCK_UUID);

    // Clear mock call history from any earlier tests
    mockQueryClient.setQueryData.mockClear();

    const { result } = renderHook(() => useLiveState('scifi'));
    await act(async () => { vi.runOnlyPendingTimers(); });

    // ── Step 1: Submit a chat message ─────────────────────────────────
    act(() => {
      result.current.submitChat('Hello world');
    });

    // Extract the optimistic-update callback that submitChat passed to
    // setQueryData, then run it to see what gets stored in the cache.
    // Use the LAST call to /api/chat to avoid picking up stale calls
    // from earlier tests (setQueryData is never restored by afterEach).
    const chatCalls = mockQueryClient.setQueryData.mock.calls
      .filter(([key]: [string[]]) => key[0] === '/api/chat');
    const optimisticUpdater = chatCalls[chatCalls.length - 1]?.[1] as ((old: unknown[]) => unknown[]) | undefined;
    expect(optimisticUpdater).toBeDefined();

    const afterOptimistic = optimisticUpdater!([]);
    expect(afterOptimistic).toHaveLength(1);
    expect(afterOptimistic[0]).toMatchObject({ text: 'Hello world' });

    // Verify WebSocket payload includes clientId for server to echo back
    const wsSendCall = wsInstance.send.mock.calls
      .find(([data]: [string]) => data.includes('SUBMIT_CHAT'));
    expect(wsSendCall).toBeDefined();
    const sentPayload = JSON.parse(wsSendCall[0]);
    expect(sentPayload.payload.clientId).toBe(MOCK_UUID);

    // ── Step 2: Server broadcasts back (with the same clientId) ──────
    mockQueryClient.setQueryData.mockClear();

    const serverMsg = {
      id: 42,
      channelId: 'scifi',
      sessionId: null,
      blockId: null,
      userId: 'test',
      username: 'test',
      text: 'Hello world',
      createdAt: new Date().toISOString(),
      clientId: MOCK_UUID,       // <--- echoed by server
    };

    act(() => {
      wsInstance.onmessage({
        data: JSON.stringify({ type: 'CHAT_MESSAGE', payload: serverMsg }),
      });
    });

    // Extract the replacement callback that the CHAT_MESSAGE handler
    // passed to setQueryData.
    const replaceCalls = mockQueryClient.setQueryData.mock.calls
      .filter(([key]: [string[]]) => key[0] === '/api/chat');
    const replaceUpdater = replaceCalls[replaceCalls.length - 1]?.[1] as ((old: unknown[]) => unknown[]) | undefined;
    expect(replaceUpdater).toBeDefined();

    // Pass in the array that currently holds the optimistic message
    const afterReplace = replaceUpdater!(afterOptimistic);

    // The optimistic placeholder must be REPLACED, not duplicated.
    expect(afterReplace).toHaveLength(1);       // ← NOT 2!
    expect(afterReplace[0].id).toBe(42);         // Server-confirmed id
    expect(afterReplace[0].text).toBe('Hello world');
  });
    
    it('submits reaction and optimistically updates', async () => {
        const { result } = renderHook(() => useLiveState('scifi'));
        await act(async () => { vi.runOnlyPendingTimers(); });

        act(() => {
            result.current.submitReaction(1, '👍', 0);
        });

        expect(wsInstance.send).toHaveBeenCalledWith(expect.stringContaining('SUBMIT_REACTION'));
        expect(result.current.reactions.some(r => r.emoji === '👍')).toBe(true);
        expect(analytics.trackEvent).toHaveBeenCalledWith('Reaction Sent', expect.any(Object));
    });

    it('handles WebSocket close and sets wsConnected to false', async () => {
        const { result } = renderHook(() => useLiveState('scifi'));
        await act(async () => { vi.runOnlyPendingTimers(); });
        expect(result.current.wsConnected).toBe(true);

        act(() => {
            wsInstance.onclose({});
        });
        expect(result.current.wsConnected).toBe(false);
    });

    it('calculates macroPhase correctly based on session times', async () => {
        const now = Date.now();
        const { result } = renderHook(() => useLiveState('scifi'));
        await act(async () => { vi.runOnlyPendingTimers(); });
        
        // Waiting
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ type: 'SESSION_STATUS', payload: { status: 'scheduled', session: { scheduledStart: new Date(now + 4 * 60 * 1000).toISOString(), scheduledEnd: new Date(now + 30 * 60 * 1000).toISOString() } } })
            });
        });
        await act(async () => { vi.advanceTimersByTime(1100); });
        expect(result.current.macroPhase).toBe('waiting');
        
        // Gathering
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ type: 'SESSION_STATUS', payload: { status: 'scheduled', session: { scheduledStart: new Date(now + 2 * 60 * 1000).toISOString(), scheduledEnd: new Date(now + 30 * 60 * 1000).toISOString() } } })
            });
        });
        await act(async () => { vi.advanceTimersByTime(1100); });
        expect(result.current.macroPhase).toBe('gathering');
        
        // Reading
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ type: 'SESSION_STATUS', payload: { status: 'active', session: { scheduledStart: new Date(now - 1 * 60 * 1000).toISOString(), scheduledEnd: new Date(now + 10 * 60 * 1000).toISOString() } } })
            });
        });
        await act(async () => { vi.advanceTimersByTime(1100); });
        expect(result.current.macroPhase).toBe('reading');
        
        // Afterparty (via resolution phase — existing behavior)
        (ReactQuery.useQuery as any).mockImplementation((options: any) => {
            if (options.queryKey.includes('/api/blocks/current')) {
                return { data: { id: 1, content: 'Test', phase: 'resolution' }, isLoading: false };
            }
            return { data: [], isLoading: false };
        });
        // We have to re-render to get the new useQuery data
        const { result: r2 } = renderHook(() => useLiveState('scifi'));
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ type: 'SESSION_STATUS', payload: { status: 'completed', session: { scheduledStart: new Date(now - 30 * 60 * 1000).toISOString(), scheduledEnd: new Date(now - 1 * 60 * 1000).toISOString() } } })
            });
        });
        await act(async () => { vi.advanceTimersByTime(1100); });
        expect(r2.current.macroPhase).toBe('afterparty');

        // Afterparty (via direct server phase — new behavior)
        (ReactQuery.useQuery as any).mockImplementation((options: any) => {
            if (options.queryKey.includes('/api/blocks/current')) {
                return { data: { id: 1, content: 'Test', phase: 'afterparty' }, isLoading: false };
            }
            if (options.queryKey.includes('/api/sessions/next')) {
                return { data: null, isLoading: false };
            }
            return { data: [], isLoading: false };
        });
        const { result: r3 } = renderHook(() => useLiveState('scifi'));
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ type: 'SESSION_STATUS', payload: { status: 'completed', session: { scheduledStart: new Date(now - 30 * 60 * 1000).toISOString(), scheduledEnd: new Date(now - 1 * 60 * 1000).toISOString() } } })
            });
        });
        await act(async () => { vi.advanceTimersByTime(1100); });
        expect(r3.current.macroPhase).toBe('afterparty');
    });
});
