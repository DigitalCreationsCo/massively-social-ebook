import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VoteOption { label: string; description?: string; }
export interface VoteResults { A: number; B: number; }

interface DecisionPhaseProps {
  phase?: "reading" | "voting" | "resolution";
  timeRemaining: number; timeToDecision: number;
  initialTimeToDecision: number; initialTimeRemaining: number;
  turnsToNextChoice: number; hasVoted: boolean;
  onVote: (choice: "A" | "B") => void;
  optionA?: VoteOption | null; optionB?: VoteOption | null;
  voteResults: VoteResults; selectedChoice?: "A" | "B" | null;
}

/** Player overlay for public A/B audience decisions and ordinary reading progress. */
export function DecisionPhase(props: DecisionPhaseProps) {
  const { phase, timeRemaining, timeToDecision, initialTimeToDecision, initialTimeRemaining, turnsToNextChoice, hasVoted, onVote, optionA, optionB, voteResults, selectedChoice } = props;
  const [previousPhase, setPreviousPhase] = useState(phase);
  const [showInterruption, setShowInterruption] = useState(false);
  useEffect(() => {
    if (previousPhase === "reading" && phase === "voting") {
      setShowInterruption(true);
      const timer = setTimeout(() => setShowInterruption(false), 1_200);
      return () => clearTimeout(timer);
    }
    setPreviousPhase(phase);
  }, [phase, previousPhase]);
  if (!phase) return null;

  const isVoting = phase === "voting" && turnsToNextChoice === 0;
  const maximum = phase === "reading" ? Math.max(initialTimeRemaining, 1) : Math.max(initialTimeToDecision, 1);
  const remaining = phase === "reading" ? timeRemaining : timeToDecision;
  const progressPercent = Math.min(100, Math.max(0, (remaining / maximum) * 100));
  const totalVotes = voteResults.A + voteResults.B;
  const percentage = (choice: "A" | "B") => totalVotes ? Math.round((voteResults[choice] / totalVotes) * 100) : 50;
  const minutes = Math.floor(timeToDecision / 60);
  const seconds = timeToDecision % 60;

  return <div className="relative flex min-h-0 w-full flex-col justify-end">
    <AnimatePresence>{showInterruption && <motion.div initial={{ opacity: 0.6 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 1.2 }} className="pointer-events-none absolute inset-0 z-50 bg-[radial-gradient(ellipse_at_center,hsla(var(--primary),0.25),transparent_70%)]" />}</AnimatePresence>
    {(isVoting || phase === "resolution" || (timeToDecision > 0 && timeToDecision < 30)) && <div className="relative z-10 mb-3 flex flex-col items-center gap-1 px-4 py-2 text-xs font-medium uppercase tracking-wider text-white/60 md:px-8 md:text-sm">
      {isVoting && <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>You decide</motion.span>}
      {phase === "resolution" && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-bold tracking-[0.2em] text-primary">The story is closing</motion.span>}
      {!isVoting && phase !== "resolution" && <span className="flex items-center gap-2 font-mono text-primary/80"><Timer className="size-4 text-white/50" />Next choice in {minutes}:{String(seconds).padStart(2, "0")}</span>}
    </div>}
    {isVoting && <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative z-10 px-4 pb-4 md:px-8">
      {!hasVoted ? <div className="grid grid-cols-2 gap-4">{(["A", "B"] as const).map((choice) => {
        const option = choice === "A" ? optionA : optionB;
        return <button key={choice} type="button" onClick={() => onVote(choice)} className={cn("group relative flex flex-col items-center overflow-hidden rounded-xl border-2 border-primary/30 bg-black/40 px-6 py-4 font-serif text-xl text-primary transition-all hover:border-primary hover:bg-primary/10 active:scale-95")}><span className="relative z-10 font-semibold">{option?.label || `Path ${choice}`}</span>{option?.description && <span className="relative z-10 mt-2 text-center font-sans text-sm text-white/60">{option.description}</span>}</button>;
      })}</div> : <motion.div initial={{ opacity: 0, y: 20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="flex justify-center"><div className="flex flex-col items-center gap-1 rounded-2xl border border-primary/40 bg-primary/10 px-8 py-4 backdrop-blur-md"><span className="text-xs uppercase tracking-widest text-primary/60">Your choice</span><span className="font-serif text-2xl font-bold text-primary">{selectedChoice === "A" ? optionA?.label || "Path A" : optionB?.label || "Path B"}</span><span className="font-mono text-lg font-bold text-primary/80">{percentage(selectedChoice ?? "A")}%</span></div></motion.div>}
    </motion.div>}
    <div className="relative z-10 h-1.5 w-full overflow-hidden bg-white/10">{phase !== "resolution" && <motion.div role="progressbar" aria-valuenow={Math.round(progressPercent)} aria-valuemin={0} aria-valuemax={100} className={cn("h-full", phase === "reading" ? "bg-white/30" : "bg-primary")} initial={{ width: `${progressPercent}%` }} animate={{ width: `${progressPercent}%` }} transition={{ ease: "linear", duration: 1 }} />}</div>
  </div>;
}
