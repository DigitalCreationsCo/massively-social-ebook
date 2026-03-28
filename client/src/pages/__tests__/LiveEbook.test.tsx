import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiveEbook from '../LiveEbook';
import { useLiveState } from '@/hooks/use-live-state';
import { useLocation } from 'wouter';

// Mock the hooks
vi.mock('@/hooks/use-live-state');
vi.mock('wouter', () => ({
    useLocation: vi.fn(),
}));

describe('LiveEbook Component Redirection', () => {
    const mockSetLocation = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useLocation as any).mockReturnValue(['/', mockSetLocation]);
    });

    it('redirects to /upcoming when sessionStatus is scheduled and not loading', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'scheduled',
            wsConnected: true,
            viewerCount: 0,
            chatHistory: [],
            currentBlock: null,
            voteResults: { A: 0, B: 0 }
        });

        render(<LiveEbook params={{ channelId: 'mystery' }} />);
        expect(mockSetLocation).toHaveBeenCalledWith('/upcoming');
    });

    it('does not redirect when sessionStatus is active', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'active',
            wsConnected: true,
            viewerCount: 10,
            chatHistory: [],
            currentBlock: { id: 1, content: 'Story starting...' },
            voteResults: { A: 0, B: 0 },
            localTimeRemaining: 10000,
            localTimeToDecision: 20000,
            localInitialTimeToDecision: 20000,
            localTurnsToNextChoice: 2,
            hasVotedCurrent: false,
            username: 'tester',
            submitChat: vi.fn(),
            submitVote: vi.fn(),
            mostRecentMessage: null
        });

        render(<LiveEbook params={{ channelId: 'mystery' }} />);
        expect(mockSetLocation).not.toHaveBeenCalled();
        expect(screen.getByText(/Story starting.../i)).toBeInTheDocument();
    });

    it('shows loading state and does not redirect while loading', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: true,
            sessionStatus: 'loading',
        });

        render(<LiveEbook params={{ channelId: 'mystery' }} />);
        expect(screen.getByText(/Opening.../i)).toBeInTheDocument();
        expect(mockSetLocation).not.toHaveBeenCalled();
    });
});
