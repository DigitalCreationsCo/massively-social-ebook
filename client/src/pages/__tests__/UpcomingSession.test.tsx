import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UpcomingSession from '../UpcomingSession';
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
        expect(screen.getByText(/Loading\.\.\./i)).toBeInTheDocument();
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

    it('handles reminder download', async () => {
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

        const emailInput = screen.getByLabelText(/Email Address/i);
        fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

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
