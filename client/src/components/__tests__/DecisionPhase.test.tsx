import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DecisionPhase } from '../DecisionPhase';

const props = {
  phase: "reading" as const,
  timeRemaining: 50,
  timeToDecision: 0,
  initialTimeToDecision: 1,
  initialTimeRemaining: 100,
  turnsToNextChoice: -1,
  hasVoted: false,
  onVote: () => undefined,
  voteResults: { A: 0, B: 0 },
};

describe('DecisionPhase', () => {
  it('renders progress bar with correct aria-valuenow', () => {
    render(<DecisionPhase {...props} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps progressPercent to 0–100 range', () => {
    const { rerender } = render(<DecisionPhase {...props} timeRemaining={-10} />);
    let bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');

    rerender(<DecisionPhase {...props} timeRemaining={150} />);
    bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });

  it('rounds to nearest integer', () => {
    render(<DecisionPhase {...props} timeRemaining={33.7} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '34');
  });

  it('updates aria-valuenow on rerender with different value', () => {
    const { rerender } = render(<DecisionPhase {...props} timeRemaining={25} />);
    let bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '25');

    rerender(<DecisionPhase {...props} timeRemaining={75} />);
    bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '75');
  });
});
