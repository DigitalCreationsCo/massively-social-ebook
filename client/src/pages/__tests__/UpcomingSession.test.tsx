import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import UpcomingSession, { getTimezoneDisplay, getTimezoneAbbr } from '../UpcomingSession';
import { useLiveState } from '@/hooks/use-live-state';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

vi.mock('@/hooks/use-live-state');
vi.mock('wouter', () => ({
    useLocation: vi.fn(),
    Link: vi.fn(),
}));
vi.mock('@/hooks/use-toast', () => ({
    useToast: vi.fn(),
}));

describe('UpcomingSession routing', () => {
    const mockSetLocation = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useLocation as any).mockReturnValue(['/upcoming', mockSetLocation]);
        (useToast as any).mockReturnValue({ toast: vi.fn() });
    });

    const liveSession = {
        id: 1,
        title: 'Live Now',
        scheduledStart: new Date(Date.now() - 10_000).toISOString(),
        scheduledEnd: new Date(Date.now() + 1_000_000).toISOString(),
    };

    it('redirects to / when isSessionLive is true', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            wsConnected: true,
            isSessionLive: true,
            sessionStatus: 'active',
            activeSession: liveSession,
        });

        render(<UpcomingSession />);
        expect(mockSetLocation).toHaveBeenCalledWith('/');
    });

    it('redirects to / for scheduled status inside the live window', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            wsConnected: true,
            isSessionLive: true,
            sessionStatus: 'scheduled',
            activeSession: liveSession,
        });

        render(<UpcomingSession />);
        expect(mockSetLocation).toHaveBeenCalledWith('/');
    });

    it('does not redirect before WebSocket connects', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            wsConnected: false,
            isSessionLive: true,
            sessionStatus: 'active',
            activeSession: liveSession,
        });

        render(<UpcomingSession />);
        expect(mockSetLocation).not.toHaveBeenCalled();
    });

    it('stays on upcoming for a future scheduled session', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            wsConnected: true,
            isSessionLive: false,
            sessionStatus: 'scheduled',
            activeSession: {
                id: 1,
                title: 'The Great Convergence',
                description: 'A grand meeting of worlds.',
                scheduledStart: new Date(Date.now() + 86400000).toISOString(),
                scheduledEnd: new Date(Date.now() + 86400000 + 1_500_000).toISOString(),
            },
        });

        render(<UpcomingSession />);
        expect(mockSetLocation).not.toHaveBeenCalled();
        expect(screen.getAllByText(/The next story starts soon/i)[0]).toBeInTheDocument();
    });
});

describe('getTimezoneDisplay', () => {
    it('returns a label for a valid timezone and falls back for invalid input', () => {
        expect(getTimezoneDisplay('America/New_York').length).toBeGreaterThan(0);
        expect(getTimezoneDisplay('Invalid/Timezone')).toBe('Invalid/Timezone');
    });
});

describe('getTimezoneAbbr', () => {
    it('returns a short label for valid timezones and empty string for invalid', () => {
        expect(typeof getTimezoneAbbr('America/New_York')).toBe('string');
        expect(getTimezoneAbbr('Invalid/Timezone')).toBe('');
    });
});
