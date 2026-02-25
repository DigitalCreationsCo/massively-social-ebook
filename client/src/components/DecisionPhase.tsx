import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Timer, Zap } from 'lucide-react';
import type { VoteOption, VoteResults } from '@/hooks/use-live-state';

interface DecisionPhaseProps {
  phase?: 'reading' | 'voting';
  timeRemaining: number;
  timeToDecision: number;
  initialTimeToDecision: number;
  turnsToNextChoice: number;
  hasVoted: boolean;
  onVote: (choice: 'A' | 'B') => void;
  optionA?: VoteOption | null;
  optionB?: VoteOption | null;
  voteResults: VoteResults;
  selectedChoice?: 'A' | 'B' | null;
}

export function DecisionPhase({ 
  phase, 
  timeRemaining, 
  timeToDecision,
  turnsToNextChoice,
  hasVoted, 
  onVote,
  optionA,
  optionB,
  voteResults,
  selectedChoice,
  initialTimeToDecision
}: DecisionPhaseProps) {
  // Progress bar represents time to next decision, not next storyblock
  const maxDecisionTime = phase === 'voting' ? 40 : Math.max(initialTimeToDecision, 1);
  const progressPercent = Math.min(100, Math.max(0, (timeToDecision / maxDecisionTime) * 100));

  // Calculate vote percentages
  const totalVotes = voteResults.A + voteResults.B;
  const percentA = totalVotes > 0 ? Math.round((voteResults.A / totalVotes) * 100) : 50;
  const percentB = totalVotes > 0 ? Math.round((voteResults.B / totalVotes) * 100) : 50;

  if (!phase) return null;

  // Time to next decision from server-provided countdown
  const totalSecondsToChoice = timeToDecision;
  const minutes = Math.floor(totalSecondsToChoice / 60);
  const seconds = totalSecondsToChoice % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  const isDecisionAvailable = turnsToNextChoice === 0 && phase === 'voting';

  return (
    <div className="w-full flex flex-col justify-end min-h-[200px]">
      <div className="flex flex-col items-center justify-center py-2 px-4 md:px-8 mb-3 gap-1">
        <div className="flex items-center gap-3 text-xs md:text-sm font-medium tracking-wider uppercase text-white/60">
          <div className="flex items-center gap-2">
            { isDecisionAvailable ? (
              <><Zap className="w-4 h-4 text-primary" /><motion.div>Decision Active</motion.div></>
            ) : (
              <><Timer className="w-4 h-4 text-white/40" /><motion.div>Narrative Evolution</motion.div></>
            ) }
          </div>
        </div>
        { !isDecisionAvailable && totalSecondsToChoice > 0 && (
          <div className="text-xs font-mono text-primary/80 tracking-widest uppercase">
            Next choice in { timeStr }
          </div>
        ) }
      </div>

      {/* Voting Area */}
      { isDecisionAvailable && (
        <motion.div 
          initial={ { opacity: 0, y: 10, scale: 0.8 } }
          animate={ { opacity: 1, y: 0, scale: 1 } }
          className="grid grid-cols-2 gap-4 px-4 pb-4 md:px-8"
        >
          {(['A', 'B'] as const).map((choice) => {
            const option = choice === 'A' ? optionA : optionB;
            const isSelected = selectedChoice === choice;
            const isWinner = hasVoted && (
              (choice === 'A' && voteResults.A >= voteResults.B) ||
              (choice === 'B' && voteResults.B >= voteResults.A)
            );
            const percentage = choice === 'A' ? percentA : percentB;

            return (
              <button
                key={choice}
                disabled={hasVoted}
                onClick={() => onVote(choice)}
                className={cn(
                  "relative group py-4 px-6 rounded-xl font-serif text-xl border-2 transition-all duration-300 overflow-hidden flex flex-col items-center",
                  hasVoted 
                    ? isWinner 
                      ? "border-primary bg-primary/20 text-primary" 
                      : "border-white/10 text-white/40 bg-black/20"
                    : "border-primary/30 text-primary hover:border-primary hover:bg-primary/10 active:scale-95 bg-black/40",
                  isSelected && hasVoted && "ring-2 ring-primary ring-offset-2 ring-offset-black"
                )}
              >
                {/* Button Inner Glow */}
                {!hasVoted && (
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-[radial-gradient(circle_at_center,hsla(var(--primary)/0.2)_0%,transparent_100%)]" />
                )}
                
                <span className="relative z-10 font-semibold">{option?.label || `Path ${choice}`}</span>
                
                {/* Description from v0 */}
                {option?.description && (
                  <span className="relative z-10 text-sm font-sans text-white/60 mt-2 text-center">
                    {option.description}
                  </span>
                )}

                {/* Vote percentage display from v0 */}
                {hasVoted && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-3 text-2xl font-mono font-bold"
                  >
                    {percentage}%
                  </motion.div>
                )}
              </button>
            );
          })}
        </motion.div>
      ) }

      {/* Progress Bar */ }
      <div className="w-full h-1.5 bg-white/10 overflow-hidden">
        <motion.div
          className={ cn("h-full", phase === 'reading' ? "bg-white/30" : "bg-primary") }
          initial={ { width: `${progressPercent}%` } }
          animate={ { width: `${progressPercent}%` } }
          transition={ { ease: "linear", duration: 1 } }
        />
      </div>

    </div>
  );
}
