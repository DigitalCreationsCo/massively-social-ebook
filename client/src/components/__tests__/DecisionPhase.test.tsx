import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DecisionPhase } from '../DecisionPhase';

describe('DecisionPhase', () => {
  it('renders progress bar with correct aria-valuenow', () => {
    render(<DecisionPhase progressPercent={50} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps progressPercent to 0–100 range', () => {
    const { rerender } = render(<DecisionPhase progressPercent={-10} />);
    let bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');

    rerender(<DecisionPhase progressPercent={150} />);
    bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });

  it('rounds to nearest integer', () => {
    render(<DecisionPhase progressPercent={33.7} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '34');
  });

  it('updates aria-valuenow on rerender with different value', () => {
    const { rerender } = render(<DecisionPhase progressPercent={25} />);
    let bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '25');

    rerender(<DecisionPhase progressPercent={75} />);
    bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '75');
  });
});
