
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
        expect(result.current.sessionStatus).toBe('loading');
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
        expect(result.current.localTimeRemaining).toBe(50);
        expect(result.current.localTimeToDecision).toBe(120);
        expect(result.current.localInitialTimeToDecision).toBe(180);
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

    it('handles VOTE_UPDATE and updates vote results', async () => {
        const { result } = renderHook(() => useLiveState('scifi'));
        await act(async () => { vi.runOnlyPendingTimers(); });
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ type: 'VOTE_UPDATE', payload: { A: 5, B: 3 } })
            });
        });
        expect(result.current.voteResults).toEqual({ A: 5, B: 3 });
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
    
    it('submits vote and updates sessionStorage', async () => {
        const { result } = renderHook(() => useLiveState('scifi'));
        await act(async () => { vi.runOnlyPendingTimers(); });

        act(() => {
            result.current.submitVote('A');
        });

        expect(wsInstance.send).toHaveBeenCalledWith(expect.stringContaining('SUBMIT_VOTE'));
        expect(sessionStorage.getItem('voted_scifi_1')).toBe('A');
        expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Vote cast!" }));
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
        
        // Afterparty
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
    });
});
