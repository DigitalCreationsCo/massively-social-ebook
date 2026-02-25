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
        turnsToNextChoice={ 3 }
        hasVoted={ false }
        onVote={ mockOnVote }
        voteResults={ mockVoteResults }
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders voting options when phase is voting and turnsToNextChoice is 0', () => {
    render(
      <DecisionPhase
        phase="voting"
        timeRemaining={ 15 }
        turnsToNextChoice={ 0 }
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

  it('does NOT render voting options when turnsToNextChoice > 0', () => {
    render(
      <DecisionPhase
        phase="voting"
        timeRemaining={ 15 }
        turnsToNextChoice={ 1 }
        hasVoted={ false }
        onVote={ mockOnVote }
        optionA={ { label: 'Path A', description: 'Description A' } }
        optionB={ { label: 'Path B', description: 'Description B' } }
        voteResults={ mockVoteResults }
      />
    );

    expect(screen.queryByText('Path A')).not.toBeInTheDocument();
    expect(screen.queryByText('Path B')).not.toBeInTheDocument();
  });

  it('renders "Next choice in X:XX" when turnsToNextChoice > 0', () => {
    render(
      <DecisionPhase
        phase="reading"
        timeRemaining={ 45 }
        turnsToNextChoice={ 1 } // 1 * 120 + 45 = 165s = 2:45
        hasVoted={ false }
        onVote={ mockOnVote }
        voteResults={ mockVoteResults }
      />
    );

    expect(screen.getByText('Next choice in 2:45')).toBeInTheDocument();
    expect(screen.getByText('Narrative Evolution')).toBeInTheDocument();
  });
});
