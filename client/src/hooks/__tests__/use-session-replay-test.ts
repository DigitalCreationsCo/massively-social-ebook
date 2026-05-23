// client/hooks/useHistoricalReplay.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSessionReplay } from '../use-session-replay';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Global fetch mock
global.fetch = vi.fn();

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
});

const wrapper = ({ children }: { children: React.ReactNode; }) => (
    <QueryClientProvider client= { queryClient } > { children } </QueryClientProvider>
);

describe('useHistoricalReplay Hook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryClient.clear();
    });

    it('fetches session first, then automatically fetches dependent blocks', async () => {
        const mockSession = { id: 99, title: 'Epic Finale' };
        const mockBlocks = [ { id: 1, content: 'It ended.' } ];

        // Mock implementation for the chained fetches
        vi.mocked(global.fetch).mockImplementation((url: RequestInfo | URL) => {
            const urlStr = url.toString();
            if (urlStr.includes('/api/sessions/history')) {
                return Promise.resolve(new Response(JSON.stringify(mockSession)));
            }
            if (urlStr.includes('/api/blocks/history')) {
                return Promise.resolve(new Response(JSON.stringify(mockBlocks)));
            }
            return Promise.reject('Not Found');
        });

        const { result } = renderHook(() => useSessionReplay({ channelId: 'scifi' }), { wrapper });

        // Initial state
        expect(result.current.isLoading).toBe(true);

        // Wait for the dependent queries to resolve
        await waitFor(() => {
            expect(result.current.session).toEqual(mockSession);
            expect(result.current.blocks).toEqual(mockBlocks);
        });

        expect(global.fetch).toHaveBeenCalledTimes(2);

        // Verify parameters were passed correctly
        const sessionCall = vi.mocked(global.fetch).mock.calls[ 0 ][ 0 ].toString();
        expect(sessionCall).toContain('channelId=scifi');

        const blocksCall = vi.mocked(global.fetch).mock.calls[ 1 ][ 0 ].toString();
        expect(blocksCall).toContain('sessionId=99');
    });
});