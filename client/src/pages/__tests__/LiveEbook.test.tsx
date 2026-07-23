import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiveEbook from '../LiveEbook';
import { useLiveState } from '@/hooks/use-live-state';
import { useLocation } from 'wouter';

vi.mock('@/hooks/use-live-state');
vi.mock('wouter', () => ({
    useLocation: vi.fn(),
}));

const liveSession = {
    scheduledStart: new Date(Date.now() - 10_000).toISOString(),
    scheduledEnd: new Date(Date.now() + 1_000_000).toISOString(),
};

describe('LiveEbook routing', () => {
    const mockSetLocation = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useLocation as any).mockReturnValue(['/', mockSetLocation]);
    });

    it('redirects to /upcoming when session is not in the live window', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            isSessionLive: false,
            wsConnected: true,
            viewerCount: 0,
            chatHistory: [],
            currentBlock: null,
        });

        render(<LiveEbook />);
        expect(mockSetLocation).toHaveBeenCalledWith('/upcoming');
    });

    it('does not redirect when isSessionLive is true', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            isSessionLive: true,
            wsConnected: true,
            viewerCount: 10,
            chatHistory: [],
            currentBlock: { id: 1, content: 'Story starting...' },
            username: 'tester',
            submitChat: vi.fn(),
            mostRecentMessage: null,
            macroPhase: 'reading',
            reactions: [],
            submitReaction: vi.fn(),
        });

        render(<LiveEbook />);
        expect(mockSetLocation).not.toHaveBeenCalled();
        expect(screen.getByText(/Story starting.../i)).toBeInTheDocument();
    });

    it('does not redirect for scheduled status inside the live window', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            isSessionLive: true,
            sessionStatus: 'scheduled',
            activeSession: liveSession,
            wsConnected: true,
            viewerCount: 0,
            chatHistory: [],
            currentBlock: { id: 1, content: 'Live chapter' },
            macroPhase: 'reading',
            reactions: [],
            submitReaction: vi.fn(),
        });

        render(<LiveEbook />);
        expect(mockSetLocation).not.toHaveBeenCalled();
    });

    it('shows loading and does not redirect while loading', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: true,
            isSessionLive: false,
        });

        render(<LiveEbook />);
        expect(screen.getByText(/Loading/i)).toBeInTheDocument();
        expect(mockSetLocation).not.toHaveBeenCalled();
    });

    it('does not redirect before WebSocket connects', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            isSessionLive: false,
            wsConnected: false,
            viewerCount: 0,
            chatHistory: [],
            currentBlock: null,
        });

        render(<LiveEbook />);
        expect(mockSetLocation).not.toHaveBeenCalled();
    });
});
