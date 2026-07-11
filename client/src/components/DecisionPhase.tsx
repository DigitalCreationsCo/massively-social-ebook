import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Timer } from "lucide-react";
import type { VoteOption, VoteResults } from "@/hooks/use-live-state";

interface DecisionPhaseProps {
  phase?: "reading" | "voting" | "resolution";
  timeRemaining: number;
  timeToDecision: number;
  initialTimeToDecision: number;
  initialTimeRemaining: number;
  turnsToNextChoice: number;
  hasVoted: boolean;
  onVote: (choice: "A" | "B") => void;
  onFollow?: () => void;
  isFollowing?: boolean;
  followerCount?: number;
  optionA?: VoteOption | null;
  optionB?: VoteOption | null;
  voteResults: VoteResults;
  selectedChoice?: "A" | "B" | null;
}

export function DecisionPhase({
  phase,
  timeRemaining,
  timeToDecision,
  turnsToNextChoice,
  hasVoted,
  onVote,
  onFollow,
  isFollowing,
  followerCount,
  optionA,
  optionB,
  voteResults,
  selectedChoice,
  initialTimeToDecision,
  initialTimeRemaining,
}: DecisionPhaseProps) {
  // Track previous phase for interruption animation on voting transition
  const [prevPhase, setPrevPhase] = useState(phase);
  const [showInterruption, setShowInterruption] = useState(false);

  useEffect(() => {
    if (prevPhase === "reading" && phase === "voting") {
      setShowInterruption(true);
      const timer = setTimeout(() => setShowInterruption(false), 1200);
      return () => clearTimeout(timer);
    }
    setPrevPhase(phase);
  }, [phase, prevPhase]);

  // Phase progress bar: reading uses current block timer, voting uses decision timer
  const maxTime =
    phase === "reading"
      ? Math.max(initialTimeRemaining, 1)
      : Math.max(initialTimeToDecision, 1);
  const current = phase === "reading" ? timeRemaining : timeToDecision;
  // Empty from 100% → 0%
  const progressPercent = Math.min(100, Math.max(0, (current / maxTime) * 100));

  // Voting phase also shows a prominent secondary countdown timer
  const votingTimerPercent =
    phase === "voting"
      ? Math.min(
          100,
          Math.max(
            0,
            (timeRemaining / Math.max(initialTimeRemaining, 1)) * 100,
          ),
        )
      : 0;

  // Calculate vote percentages
  const totalVotes = voteResults.A + voteResults.B;
  const percentA =
    totalVotes > 0 ? Math.round((voteResults.A / totalVotes) * 100) : 50;
  const percentB =
    totalVotes > 0 ? Math.round((voteResults.B / totalVotes) * 100) : 50;

  if (!phase) return null;

  // Time to next decision from server-provided countdown
  const totalSecondsToChoice = timeToDecision;
  const minutes = Math.floor(totalSecondsToChoice / 60);
  const seconds = totalSecondsToChoice % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  const isDecisionAvailable = turnsToNextChoice === 0 && phase === "voting";

  return (
    <div className="w-full flex flex-col justify-end min-h-0 relative">
      {/* Interruption flash on voting transition */}
      <AnimatePresence>
        {showInterruption && (
          <motion.div
            key="interruption-flash"
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            className="absolute inset-0 z-50 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at center, hsla(var(--primary), 0.25) 0%, transparent 70%)",
            }}
          />
        )}
      </AnimatePresence>

      <div className="flex flex-col items-center justify-center py-2 px-4 md:px-8 mb-3 gap-1 relative z-10">
        <div className="flex items-center gap-3 text-xs md:text-sm font-medium tracking-wider uppercase text-white/60">
          <div className="flex items-center gap-2">
            {isDecisionAvailable && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2"
              >
                You Decide
              </motion.div>
            )}
            {phase === "resolution" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 text-primary font-bold tracking-[0.2em]"
              >
                Episode Complete
              </motion.div>
            )}
          </div>
        </div>
        {!isDecisionAvailable &&
          phase !== "resolution" &&
          totalSecondsToChoice < 30 &&
          totalSecondsToChoice > 0 && (
            <motion.div className="flex items-center gap-2 text-xs font-mono text-primary/80 tracking-widest uppercase">
              <Timer className="w-4 h-4 text-white/50" />
              Next choice in {timeStr}
            </motion.div>
          )}
      </div>

      {/* Voting Area */}
      {isDecisionAvailable && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="px-4 pb-4 md:px-8 relative z-10"
        >
          {!hasVoted ? (
            <motion.div
              key="options"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="grid grid-cols-2 gap-4"
            >
              {(["A", "B"] as const).map((choice) => {
                const option = choice === "A" ? optionA : optionB;

                return (
                  <button
                    key={choice}
                    onClick={() => onVote(choice)}
                    className={cn(
                      "relative group py-4 px-6 rounded-xl font-serif text-xl border-2 transition-all duration-300 overflow-hidden flex flex-col items-center",
                      "border-primary/30 text-primary hover:border-primary hover:bg-primary/10 active:scale-95 bg-black/40",
                    )}
                  >
                    {/* Button Inner Glow */}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-[radial-gradient(circle_at_center,hsla(var(--primary)/0.2)_0%,transparent_100%)]" />

                    <span className="relative z-10 font-semibold">
                      {option?.label || `Path ${choice}`}
                    </span>

                    {option?.description && (
                      <span className="relative z-10 text-sm font-sans text-white/60 mt-2 text-center">
                        {option.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="toast"
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="flex justify-center"
            >
              <div className="bg-primary/10 backdrop-blur-md border border-primary/40 px-8 py-4 rounded-2xl shadow-[0_0_30px_rgba(var(--primary-rgb),0.2)] flex flex-col items-center gap-1 group">
                <span className="text-primary/60 text-xs font-medium tracking-widest uppercase">
                  Your Choice
                </span>
                <span className="text-primary text-2xl font-serif font-bold tracking-tight">
                  {selectedChoice === "A"
                    ? optionA?.label || "Path A"
                    : optionB?.label || "Path B"}
                </span>
                <div className="mt-2 flex items-center gap-4 w-full">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                  <span className="text-primary/80 font-mono text-lg font-bold">
                    {selectedChoice === "A" ? percentA : percentB}%
                  </span>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* End of Episode Follow Flow */}
      {phase === "resolution" && onFollow && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 pb-4 md:px-8 relative z-10"
        >
          <div className="bg-black/40 backdrop-blur-md border border-white/10 px-6 py-6 rounded-2xl space-y-4">
            <div className="text-center space-y-2">
              <h3 className="text-xl font-serif font-semibold text-white">
                Episode 2 releases Tuesday
              </h3>
              <p className="text-white/60 font-sans text-sm">
                Follow to receive Episode 2
              </p>
            </div>
            
            {followerCount && (
              <div className="text-center">
                <p className="text-xs text-white/40 font-mono">
                  Join {followerCount.toLocaleString()} readers following this story
                </p>
              </div>
            )}

            {!isFollowing ? (
              <button
                onClick={onFollow}
                className="w-full py-3 px-6 rounded-xl font-serif text-lg border-2 border-primary/30 text-primary hover:border-primary hover:bg-primary/10 transition-all duration-300"
              >
                Follow This Story
              </button>
            ) : (
              <div className="w-full py-3 px-6 rounded-xl font-serif text-lg border-2 border-primary/20 bg-primary/5 text-primary/60 text-center">
                ✓ Following
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Progress Bar — shows phase-level timer */}
      <div className="w-full h-1.5 bg-white/10 overflow-hidden relative z-10">
        {phase !== "resolution" && (
          <motion.div
            role="progressbar"
            aria-valuenow={Math.round(progressPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            className={cn(
              "h-full",
              phase === "reading" ? "bg-white/30" : "bg-primary",
            )}
            initial={{ width: `${progressPercent}%` }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ ease: "linear", duration: 1 }}
          />
        )}
      </div>

      {/* Voting phase: prominent negative countdown timer */}
      {phase === "voting" && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full h-1 bg-primary/20 overflow-hidden relative z-10"
        >
          <motion.div
            className="h-full bg-primary"
            initial={{ width: `${votingTimerPercent}%` }}
            animate={{ width: `${votingTimerPercent}%` }}
            transition={{ ease: "linear", duration: 1 }}
          />
        </motion.div>
      )}
    </div>
  );
}
