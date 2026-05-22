import { renderHook, act } from '@testing-library/react';
import { useLiveState } from '../use-live-state';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as ReactQuery from '@tanstack/react-query';

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

describe('useLiveState session lifecycle', () => {
    let wsInstance: any;
    const mockQueryClient = {
        invalidateQueries: vi.fn(),
        setQueryData: vi.fn(),
    };

    beforeEach(() => {
        vi.useFakeTimers();
        
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
        
        Object.defineProperty(window, 'location', {
            value: { protocol: 'http:', host: 'localhost:5001' },
            writable: true
        });
        
        class MockWebSocket {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;
            onopen: any = null;
            onmessage: any = null;
            onclose: any = null;
            onerror: any = null;
            readyState: number = 0;
            close = vi.fn(() => {
                this.readyState = 3;
            });
            send = vi.fn();

            constructor() {
                wsInstance = this;
                this.readyState = 1;
                if (this.onopen) this.onopen();
            }
        }
        (global as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('sets macroPhase to waiting when session is more than START_BEFORE_MS away', () => {
        const now = Date.now();
        const START_BEFORE_MS = 3 * 60 * 1000;
        const { result } = renderHook(() => useLiveState('scifi'));
        
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ 
                    type: 'SESSION_STATUS', 
                    payload: { 
                        status: 'scheduled', 
                        session: { 
                            scheduledStart: new Date(now + START_BEFORE_MS + 60000).toISOString(), 
                            scheduledEnd: new Date(now + 30 * 60 * 1000).toISOString() 
                        } 
                    } 
                })
            });
        });
        
        expect(result.current.macroPhase).toBe('waiting');
    });

    it('sets macroPhase to gathering when session is within START_BEFORE_MS', () => {
        const now = Date.now();
        const { result } = renderHook(() => useLiveState('scifi'));
        
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ 
                    type: 'SESSION_STATUS', 
                    payload: { 
                        status: 'scheduled', 
                        session: { 
                            scheduledStart: new Date(now + 60000).toISOString(), 
                            scheduledEnd: new Date(now + 30 * 60 * 1000).toISOString() 
                        } 
                    } 
                })
            });
        });
        
        expect(result.current.macroPhase).toBe('gathering');
    });

    it('sets macroPhase to reading when session has started', () => {
        const now = Date.now();
        const { result } = renderHook(() => useLiveState('scifi'));
        
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ 
                    type: 'SESSION_STATUS', 
                    payload: { 
                        status: 'active', 
                        session: { 
                            scheduledStart: new Date(now - 60000).toISOString(), 
                            scheduledEnd: new Date(now + 30 * 60 * 1000).toISOString() 
                        } 
                    } 
                })
            });
        });
        
        expect(result.current.macroPhase).toBe('reading');
    });

    it('updates sessionStatus when SESSION_STATUS message received', () => {
        const now = Date.now();
        const { result } = renderHook(() => useLiveState('scifi'));
        
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ 
                    type: 'SESSION_STATUS', 
                    payload: { 
                        status: 'active', 
                        session: { 
                            id: 1, 
                            scheduledStart: new Date(now).toISOString(), 
                            scheduledEnd: new Date(now + 30 * 60 * 1000).toISOString() 
                        } 
                    } 
                })
            });
        });
        
        expect(result.current.sessionStatus).toBe('active');
    });

    it('invalidates queries when session becomes active', () => {
        const now = Date.now();
        const { result } = renderHook(() => useLiveState('scifi'));
        
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ 
                    type: 'SESSION_STATUS', 
                    payload: { 
                        status: 'active', 
                        session: { 
                            id: 1, 
                            scheduledStart: new Date(now).toISOString(), 
                            scheduledEnd: new Date(now + 30 * 60 * 1000).toISOString() 
                        } 
                    } 
                })
            });
        });
        
        expect(mockQueryClient.invalidateQueries).toHaveBeenCalled();
    });

    it('marks session as completed when end time has passed', () => {
        const now = Date.now();
        const pastEnd = new Date(now - 60000);
        const { result } = renderHook(() => useLiveState('scifi'));
        
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ 
                    type: 'SESSION_STATUS', 
                    payload: { 
                        status: 'active', 
                        session: { 
                            id: 1, 
                            scheduledStart: new Date(now - 30 * 60 * 1000).toISOString(), 
                            scheduledEnd: pastEnd.toISOString() 
                        } 
                    } 
                })
            });
        });
        
        expect(result.current.sessionStatus).toBe('completed');
    });

    it('handles scheduled status without triggering redirect logic', () => {
        const now = Date.now();
        const { result } = renderHook(() => useLiveState('scifi'));
        
        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({ 
                    type: 'SESSION_STATUS', 
                    payload: { 
                        status: 'scheduled', 
                        session: { 
                            id: 1, 
                            scheduledStart: new Date(now + 10 * 60 * 1000).toISOString(), 
                            scheduledEnd: new Date(now + 40 * 60 * 1000).toISOString() 
                        } 
                    } 
                })
            });
        });
        
        expect(result.current.sessionStatus).toBe('scheduled');
    });

    it('sets isSessionLive when scheduled status is inside the live window', () => {
        const now = Date.now();
        const { result } = renderHook(() => useLiveState('scifi'));

        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({
                    type: 'SESSION_STATUS',
                    payload: {
                        status: 'scheduled',
                        session: {
                            id: 1,
                            scheduledStart: new Date(now - 60_000).toISOString(),
                            scheduledEnd: new Date(now + 30 * 60 * 1000).toISOString(),
                        },
                    },
                }),
            });
        });

        expect(result.current.sessionStatus).toBe('scheduled');
        expect(result.current.isSessionLive).toBe(true);
    });

    it('sets isSessionLive false for a future scheduled session', () => {
        const now = Date.now();
        const { result } = renderHook(() => useLiveState('scifi'));

        act(() => {
            wsInstance.onmessage({
                data: JSON.stringify({
                    type: 'SESSION_STATUS',
                    payload: {
                        status: 'scheduled',
                        session: {
                            id: 1,
                            scheduledStart: new Date(now + 60 * 60 * 1000).toISOString(),
                            scheduledEnd: new Date(now + 90 * 60 * 1000).toISOString(),
                        },
                    },
                }),
            });
        });

        expect(result.current.isSessionLive).toBe(false);
    });
});