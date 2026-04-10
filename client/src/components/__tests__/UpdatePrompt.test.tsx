import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UpdatePrompt } from '../pwa/UpdatePrompt';

vi.mock('../../hooks/use-pwa-update', () => ({
  usePWAUpdate: vi.fn(),
}));

vi.mock('../../lib/analytics', () => ({
  trackEvent: vi.fn(),
}));

import { usePWAUpdate } from '../../hooks/use-pwa-update';

describe('UpdatePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when no error', () => {
    vi.mocked(usePWAUpdate).mockReturnValue({
      updateError: null,
    });

    const { container } = render(<UpdatePrompt />);
    expect(container.firstChild).toBeNull();
  });

  it('shows error message when update fails', () => {
    vi.mocked(usePWAUpdate).mockReturnValue({
      updateError: 'Network error',
    });

    render(<UpdatePrompt />);
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });
});