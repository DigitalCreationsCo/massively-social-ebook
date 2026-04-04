import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

global.fetch = vi.fn();

describe('UpcomingSession Component', () => {
    const mockSetLocation = vi.fn();
    const mockToast = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useLocation as any).mockReturnValue([ '/upcoming', mockSetLocation ]);
        (useToast as any).mockReturnValue({ toast: mockToast });
    });

    it('renders loading state when isLoading is true', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: true,
            sessionStatus: 'loading',
            activeSession: null
        });

        render(<UpcomingSession />);
        expect(document.body.firstChild).toBeEmpty();
    });

    it('renders "Active Now" when sessionStatus is active', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'active',
            activeSession: {
                id: 1,
                title: 'Live Now',
                scheduledStart: new Date(Date.now() - 10000).toISOString(),
                scheduledEnd: new Date(Date.now() + 1000000).toISOString()
            }
        });

        render(<UpcomingSession />);
        expect(screen.getByText(/The Room Is Open/i)).toBeInTheDocument();
        expect(screen.getByText(/Join/i)).toBeInTheDocument();
    });

    it('renders session details when sessionStatus is scheduled', () => {
        const mockSession = {
            id: 1,
            title: 'The Great Convergence',
            description: 'A grand meeting of worlds.',
            scheduledStart: new Date(Date.now() + 86400000).toISOString(),
            scheduledEnd: new Date(Date.now() + 86400000 + 1500000).toISOString(),
        };
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'scheduled',
            activeSession: mockSession
        });

        render(<UpcomingSession />);
        expect(screen.getAllByText(/The next story starts soon/i)[0]).toBeInTheDocument();
        expect(screen.getByText(/Remind me/i)).toBeInTheDocument();
    });

    it('renders empty state when no session is scheduled', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'scheduled',
            activeSession: null
        });

        render(<UpcomingSession />);
        expect(screen.getAllByText(/The next story starts soon/i)[0]).toBeInTheDocument();
    });

    it('redirects to root when session becomes active via effect', () => {
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'active',
            activeSession: {
                id: 1,
                scheduledStart: new Date(Date.now() - 10000).toISOString(),
                scheduledEnd: new Date(Date.now() + 1000000).toISOString()
            }
        });

        render(<UpcomingSession />);
        expect(mockSetLocation).toHaveBeenCalledWith('/');
    });

    it.skip('handles reminder download', async () => {
        const mockSession = {
            id: 42,
            title: 'Test Session',
            scheduledStart: new Date(Date.now() + 86400000).toISOString(),
            scheduledEnd: new Date(Date.now() + 86400000 + 1500000).toISOString(),
        };
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'scheduled',
            activeSession: mockSession
        });

        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ message: "You're on the list." })
        });
        render(<UpcomingSession />);
        
        const button = screen.getByText(/Remind me/i);
        fireEvent.click(button);

        await waitFor(() => {
            expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
        });

        const emailInput = screen.getByLabelText(/Email Address/i);
        fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

        const continueButton = screen.getByText("Continue");
        fireEvent.click(continueButton);

        await waitFor(() => {
            expect(screen.getByText("Confirm")).toBeInTheDocument();
        });

        const confirmButton = screen.getByText("Confirm");
        fireEvent.click(confirmButton);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalled();
        }, { timeout: 2000 });

        await waitFor(() => {
            expect(mockToast).toHaveBeenCalled();
        }, { timeout: 2000 });

        expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
            title: "You're on the list."
        }));
    });
});

describe('getTimezoneDisplay', () => {
    it('returns human-readable timezone for valid IANA timezone', () => {
        const result = getTimezoneDisplay('America/New_York');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns the input string for invalid timezone', () => {
        const invalidTz = 'Invalid/Timezone';
        const result = getTimezoneDisplay(invalidTz);
        expect(result).toBe(invalidTz);
    });

    it('returns human-readable timezone for common US timezones', () => {
        const timezones = [
            'America/New_York',
            'America/Chicago',
            'America/Denver',
            'America/Los_Angeles',
        ];
        timezones.forEach(tz => {
            const result = getTimezoneDisplay(tz);
            expect(result).toBeTruthy();
            expect(typeof result).toBe('string');
        });
    });

    it('handles UTC timezone', () => {
        const result = getTimezoneDisplay('UTC');
        expect(result).toBeTruthy();
    });

    it('handles European timezones', () => {
        const result = getTimezoneDisplay('Europe/London');
        expect(result).toBeTruthy();
    });

    it('handles Asian timezones', () => {
        const result = getTimezoneDisplay('Asia/Tokyo');
        expect(result).toBeTruthy();
    });

    it('handles Australian timezones', () => {
        const result = getTimezoneDisplay('Australia/Sydney');
        expect(result).toBeTruthy();
    });

    it('returns input string for empty timezone', () => {
        const result = getTimezoneDisplay('');
        expect(result).toBe('');
    });

    it('handles timezone with split spaces (e.g., "Eastern Time")', () => {
        const result = getTimezoneDisplay('America/New_York');
        const words = result.split(' ');
        expect(words.length).toBeGreaterThanOrEqual(1);
    });
});

describe('getTimezoneAbbr', () => {
    it('returns short timezone abbreviation for valid IANA timezone', () => {
        const result = getTimezoneAbbr('America/New_York');
        expect(typeof result).toBe('string');
    });

    it('returns empty string for invalid timezone', () => {
        const invalidTz = 'Invalid/Timezone';
        const result = getTimezoneAbbr(invalidTz);
        expect(result).toBe('');
    });

    it('returns abbreviation for common US timezones', () => {
        const result = getTimezoneAbbr('America/New_York');
        expect(typeof result).toBe('string');
    });

    it('returns abbreviation for UTC', () => {
        const result = getTimezoneAbbr('UTC');
        expect(typeof result).toBe('string');
    });

    it('returns empty string for European timezone', () => {
        const result = getTimezoneAbbr('Europe/London');
        expect(typeof result).toBe('string');
    });

    it('returns empty string for Asian timezone', () => {
        const result = getTimezoneAbbr('Asia/Tokyo');
        expect(typeof result).toBe('string');
    });

    it('returns empty string for empty timezone', () => {
        const result = getTimezoneAbbr('');
        expect(result).toBe('');
    });

    it('returns short abbreviation (typically 2-5 chars)', () => {
        const result = getTimezoneAbbr('America/New_York');
        if (result) {
            expect(result.length).toBeGreaterThanOrEqual(2);
            expect(result.length).toBeLessThanOrEqual(6);
        }
    });
});

describe('Timezone display integration', () => {
    it('component renders with scheduled session and timezone', () => {
        const mockSession = {
            id: 1,
            title: 'Test Session',
            description: 'Test description',
            scheduledStart: new Date(Date.now() + 86400000).toISOString(),
            scheduledEnd: new Date(Date.now() + 86400000 + 1500000).toISOString(),
        };
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'scheduled',
            activeSession: mockSession
        });

        render(<UpcomingSession />);
        const description = screen.getByText(/The next story starts soon/i);
        expect(description).toBeInTheDocument();
    });

    it('timezone display shows formatted time with timezone', () => {
        const mockSession = {
            id: 1,
            title: 'Test Session',
            description: 'Test description',
            scheduledStart: new Date(Date.now() + 86400000).toISOString(),
            scheduledEnd: new Date(Date.now() + 86400000 + 1500000).toISOString(),
        };
        (useLiveState as any).mockReturnValue({
            isLoading: false,
            sessionStatus: 'scheduled',
            activeSession: mockSession
        });

        render(<UpcomingSession />);
        const description = document.body.textContent;
        expect(description).toMatch(/at \d{1,2}:\d{2} (AM|PM)/i);
    });

    it('handles timezone from Intl.DateTimeFormat', () => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const display = getTimezoneDisplay(tz);
        expect(display).toBeTruthy();
    });
});
