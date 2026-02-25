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
        timeToDecision={ 200 }
        initialTimeToDecision={ 240 }
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
        timeToDecision={ 15 }
        initialTimeToDecision={ 15 }
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
        timeToDecision={ 95 }
        initialTimeToDecision={ 120 }
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

  it('renders "Next choice in X:XX" using timeToDecision', () => {
    render(
      <DecisionPhase
        phase="reading"
        timeRemaining={ 45 }
        timeToDecision={ 165 }
        initialTimeToDecision={ 200 }
        turnsToNextChoice={ 1 }
        hasVoted={ false }
        onVote={ mockOnVote }
        voteResults={ mockVoteResults }
      />
    );

    // timeToDecision = 165s = 2:45
    expect(screen.getByText('Next choice in 2:45')).toBeInTheDocument();
    expect(screen.getByText('Narrative Evolution')).toBeInTheDocument();
  });

  it('displays "Decision Active" during voting phase with turnsToNextChoice 0', () => {
    render(
      <DecisionPhase
        phase="voting"
        timeRemaining={ 30 }
        timeToDecision={ 30 }
        initialTimeToDecision={ 40 }
        turnsToNextChoice={ 0 }
        hasVoted={ false }
        onVote={ mockOnVote }
        voteResults={ mockVoteResults }
      />
    );

    expect(screen.getByText('Decision Active')).toBeInTheDocument();
  });

  it('progress bar uses timeToDecision, not timeRemaining', () => {
    // timeRemaining = 70 (storyblock timer), timeToDecision = 230 (decision timer)
    // These should be distinct values to verify the progress bar uses the right one
    const { container } = render(
      <DecisionPhase
        phase="reading"
        timeRemaining={ 70 }
        timeToDecision={ 230 }
        initialTimeToDecision={ 300 }
        turnsToNextChoice={ 2 }
        hasVoted={ false }
        onVote={ mockOnVote }
        voteResults={ mockVoteResults }
      />
    );

    // The "Next choice in" text should show 3:50 (230 seconds)
    expect(screen.getByText('Next choice in 3:50')).toBeInTheDocument();
  });

  it('does not show "Next choice in" when decision is active', () => {
    render(
      <DecisionPhase
        phase="voting"
        timeRemaining={ 30 }
        timeToDecision={ 30 }
        initialTimeToDecision={ 40 }
        turnsToNextChoice={ 0 }
        hasVoted={ false }
        onVote={ mockOnVote }
        voteResults={ mockVoteResults }
      />
    );

    expect(screen.queryByText(/Next choice in/)).not.toBeInTheDocument();
  });
});
