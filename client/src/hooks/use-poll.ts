import { useCallback, useState } from "react";

export type PollChoice = "A" | "B";

export interface PollState {
  voteResults: { A: number; B: number };
  hasVoted: boolean;
  selectedChoice: PollChoice | null;
  onVote: (choice: PollChoice) => void;
}

/**
 * Local poll state shaped like the portals `Polls` tally.
 *
 * Conservative first step: the tally lives in component state only, so the
 * existing `DecisionPhase` props keep working with no server change. A later
 * pass can back `onVote` with `Polls.vote` and replace the local counts with
 * the shared tally without changing the component contract.
 */
export function usePoll(): PollState {
  const [voteResults, setVoteResults] = useState({ A: 0, B: 0 });
  const [selectedChoice, setSelectedChoice] = useState<PollChoice | null>(null);

  const onVote = useCallback((choice: PollChoice) => {
    setSelectedChoice((previous) => {
      if (previous !== null) return previous;
      setVoteResults((tally) => ({ ...tally, [choice]: tally[choice] + 1 }));
      return choice;
    });
  }, []);

  return {
    voteResults,
    hasVoted: selectedChoice !== null,
    selectedChoice,
    onVote,
  };
}
