import { AnimatePresence, motion } from "framer-motion";

export default function Timer({
  timeLeft,
  timerHelpText,
}: {
  timeLeft: string;
  timerHelpText: string;
}) {
  const characters = timeLeft.split("");

  return (
    timeLeft && (
      <div className="text-center space-y-1 mb-2">
        <p className="text-xs text-sans font-normal tracking-[0.3em] text-primary/50 uppercase">
          {timerHelpText}
        </p>

        <div className="flex justify-center items-center h-14 overflow-visible">
          {characters.map((char, index) => (
            <div key={index} className="relative w-6 h-full overflow-visible">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={`${index}-${char}`}
                  initial={{
                    y: "40%",
                    opacity: 0,
                  }}
                  animate={{
                    y: "0%",
                    opacity: 1,
                  }}
                  exit={{
                    y: "-30%",
                    opacity: 0,
                  }}
                  transition={{
                    duration: 0.22,
                    ease: [0.23, 1, 0.32, 1],
                  }}
                  className={`absolute inset-0
                              flex items-center justify-center
                              text-5xl font-serif font-semibold
                              tabular-nums text-primary text-glow-primary`}
                >
                  {char}
                </motion.span>
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    )
  );
}
