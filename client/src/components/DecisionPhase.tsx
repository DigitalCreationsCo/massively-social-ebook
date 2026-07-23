import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface DecisionPhaseProps {
  /** 0–100 progress percentage for the reading progress bar. */
  progressPercent: number;
}

/**
 * Reading progress indicator for the on-demand reading experience.
 *
 * Shows a progress bar filling from left to right as the reader advances
 * through the episode blocks. The parent component owns the "Episode
 * Complete" banner so there is no duplicate rendering.
 */
export function DecisionPhase({
  progressPercent,
}: DecisionPhaseProps) {
  const clamped = Math.round(Math.min(100, Math.max(0, progressPercent)));

  return (
    <div className="w-full flex flex-col justify-end min-h-0 relative">
      {/* ── Progress Bar ─────────────────────────────────────────────── */}
      <div className="w-full h-1.5 bg-white/10 overflow-hidden relative z-10">
        <motion.div
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
          className={cn("h-full bg-white/30")}
          initial={{ width: `${clamped}%` }}
          animate={{ width: `${clamped}%` }}
          transition={{ ease: "linear", duration: 1 }}
        />
      </div>
    </div>
  );
}
