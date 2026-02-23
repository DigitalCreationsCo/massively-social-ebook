import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Timer, Zap } from 'lucide-react';

interface DecisionPhaseProps {
  phase?: 'reading' | 'voting';
  timeRemaining: number;
  hasVoted: boolean;
  onVote: (choice: 'A' | 'B') => void;
}

export function DecisionPhase({ phase, timeRemaining, hasVoted, onVote }: DecisionPhaseProps) {
  // Max time assumptions for progress bar (could be dynamic from backend, assuming 120s reading, 30s voting)
  const maxTime = phase === 'reading' ? 120 : 30;
  const progressPercent = Math.min(100, Math.max(0, (timeRemaining / maxTime) * 100));

  if (!phase) return null;

  return (
    <div className="w-full flex flex-col p-4 md:px-8">
      {/* Timer Header */}
      <div className="flex items-center justify-between mb-3 text-xs md:text-sm font-medium tracking-wider uppercase text-white/60">
        <div className="flex items-center gap-2">
          {phase === 'reading' ? (
            <><Timer className="w-4 h-4" /> Reading Phase</>
          ) : (
            <><Zap className="w-4 h-4 text-primary" /> Decision Phase</>
          )}
        </div>
        <div className={cn("font-mono font-bold", phase === 'voting' && timeRemaining <= 10 ? "text-destructive animate-pulse" : "")}>
          00:{timeRemaining.toString().padStart(2, '0')}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mb-4">
        <motion.div 
          className={cn("h-full rounded-full", phase === 'reading' ? "bg-white/30" : "bg-primary")}
          initial={{ width: `${progressPercent}%` }}
          animate={{ width: `${progressPercent}%` }}
          transition={{ ease: "linear", duration: 1 }}
        />
      </div>

      {/* Voting Area */}
      {phase === 'voting' && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 gap-4"
        >
          {['A', 'B'].map((choice) => (
            <button
              key={choice}
              disabled={hasVoted}
              onClick={() => onVote(choice as 'A' | 'B')}
              className={cn(
                "relative group py-4 px-6 rounded-xl font-serif text-xl border-2 transition-all duration-300 overflow-hidden",
                hasVoted 
                  ? "border-white/10 text-white/40 cursor-not-allowed bg-black/20" 
                  : "border-primary/30 text-primary hover:border-primary hover:bg-primary/10 active:scale-95 bg-black/40"
              )}
            >
              {/* Button Inner Glow */}
              {!hasVoted && (
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-[radial-gradient(circle_at_center,hsla(var(--primary)/0.2)_0%,transparent_100%)]" />
              )}
              <span className="relative z-10">Path {choice}</span>
            </button>
          ))}
        </motion.div>
      )}
      
      {phase === 'reading' && (
        <div className="py-2 text-center text-sm text-white/40 italic">
          Read carefully. A decision approaches.
        </div>
      )}
    </div>
  );
}
