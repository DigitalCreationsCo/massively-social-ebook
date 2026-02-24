import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DecisionPhase } from '../DecisionPhase';

describe('DecisionPhase', () => {
  const mockOnVote = vi.fn();
  const mockVoteResults = { A: 10, B: 20 };

  it('returns null when phase is not provided (per user preference)', () => {
    const { container } = render(
      <DecisionPhase
        timeRemaining={ 30 }
        hasVoted={ false }
        onVote={ mockOnVote }
        voteResults={ mockVoteResults }
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders voting options when phase is voting', () => {
    render(
      <DecisionPhase
        phase="voting"
        timeRemaining={ 15 }
        hasVoted={ false }
        onVote={ mockOnVote }
        optionA={ { label: 'Path A', description: 'Description A' } }
        optionB={ { label: 'Path B', description: 'Description B' } }
        voteResults={ mockVoteResults }
      />
    );

    expect(screen.getByText('Path A')).toBeInTheDocument();
    expect(screen.getByText('Path B')).toBeInTheDocument();
  });

  it('renders reading status (progress bar) when phase is reading', () => {
    const { container } = render(
      <DecisionPhase
        phase="reading"
        timeRemaining={ 45 }
        hasVoted={ false }
        onVote={ mockOnVote }
        voteResults={ mockVoteResults }
      />
    );

    // Header text "00:45" was removed by user, so we check for the progress bar area
    const progressBar = container.querySelector('.bg-white\\/30');
    expect(progressBar).toBeInTheDocument();
  });
});
