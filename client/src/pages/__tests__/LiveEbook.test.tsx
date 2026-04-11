import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiveEbook from '../LiveEbook';
import { useLiveState } from '@/hooks/use-live-state';
import { useLocation } from 'wouter';

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

        render(<LiveEbook />);
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

        render(<LiveEbook />);
        expect(mockSetLocation).not.toHaveBeenCalled();
        expect(screen.getByText(/Story starting.../i)).toBeInTheDocument();
    });

    it('shows loading state and does not redirect while loading', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: true,
            sessionStatus: 'loading',
        });

        render(<LiveEbook />);
        expect(screen.getByText(/Loading/i)).toBeInTheDocument();
        expect(mockSetLocation).not.toHaveBeenCalled();
    });

    it('does not redirect when wsConnected is false even if session not active', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'scheduled',
            wsConnected: false,
            viewerCount: 0,
            chatHistory: [],
            currentBlock: null,
            voteResults: { A: 0, B: 0 }
        });

        render(<LiveEbook />);
        expect(mockSetLocation).not.toHaveBeenCalled();
    });

    it('redirects when wsConnected is true but sessionStatus is scheduled after initial load', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'scheduled',
            wsConnected: true,
            viewerCount: 0,
            chatHistory: [],
            currentBlock: null,
            voteResults: { A: 0, B: 0 }
        });

        render(<LiveEbook />);
        expect(mockSetLocation).toHaveBeenCalledWith('/upcoming');
    });

    it('redirects when session is completed and wsConnected is true', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'completed',
            wsConnected: true,
            viewerCount: 10,
            chatHistory: [],
            currentBlock: { id: 1, content: 'Story' },
            voteResults: { A: 5, B: 3 }
        });

        render(<LiveEbook />);
        expect(mockSetLocation).toHaveBeenCalledWith('/upcoming');
    });
});
