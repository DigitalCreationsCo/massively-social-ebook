import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UpcomingSession from '../UpcomingSession';

vi.mock('@/components/LiveBroadcastSection', () => ({
    LiveBroadcastSection: ({ channelId }: { channelId?: string }) => (
        <div data-testid="live-broadcast-section">{channelId ?? 'no channel'}</div>
    ),
}));

global.fetch = vi.fn();

function renderPage() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <UpcomingSession />
        </QueryClientProvider>,
    );
}

const liveSession = {
    id: 1,
    title: 'Season 1: The Great Convergence',
    description: 'A grand meeting of worlds.',
    scheduledStart: new Date(Date.now() - 10_000).toISOString(),
    scheduledEnd: new Date(Date.now() + 1_000_000).toISOString(),
    status: 'active',
};

const channel = {
    id: 1,
    channelId: '25th-chapter',
    name: '25th Chapter',
    description: null,
    coverImage: null,
    createdAt: new Date().toISOString(),
};

describe('UpcomingSession page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows a loading state while the next session loads', () => {
        vi.mocked(global.fetch).mockReturnValue(new Promise(() => {}));
        renderPage();

        expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('renders the live broadcast section and hero content once the session loads', async () => {
        vi.mocked(global.fetch).mockResolvedValue(
            new Response(JSON.stringify({ session: liveSession, channel })),
        );
        renderPage();

        await waitFor(() => {
            expect(screen.getByTestId('live-broadcast-section')).toBeInTheDocument();
        });
        expect(screen.getByText(/one mystery/i)).toBeInTheDocument();
        expect(screen.getByText(/take part in the ongoing mystery/i)).toBeInTheDocument();
    });

    it('renders the FAQ section', async () => {
        vi.mocked(global.fetch).mockResolvedValue(
            new Response(JSON.stringify({ session: liveSession, channel })),
        );
        renderPage();

        await waitFor(() => {
            expect(screen.getByText(/everything you need to know/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/how do episodes work/i)).toBeInTheDocument();
    });
});
