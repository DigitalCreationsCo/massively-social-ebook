import { AnimatePresence, motion } from "framer-motion";

export default function Timer({ timeLeft, timerHelpText }: { timeLeft: string, timerHelpText: string; }) {
    const characters = timeLeft.split("");

    return (
        timeLeft && (
            <div className="text-center space-y-1 mb-2">
                <p className="text-[10px] tracking-[0.3em] text-primary/50 uppercase">
                    { timerHelpText }
                </p>
                <div className="flex justify-start items-baseline overflow-hidden h-14 w-48 mx-auto">
                    { characters.map((char, index) => (
                        <div key={ `${index}-${char}` } className="relative w-fit flex ml-0">
                            <AnimatePresence mode="popLayout">
                                <motion.span
                                    key={ char }
                                    initial={ { y: 30, opacity: 1 } }
                                    animate={ { y: 0, opacity: 1 } }
                                    exit={ { y: -30, opacity: 0 } }
                                    transition={ {
                                        duration: 0.2,
                                        ease: [ 0.23, 1, 0.32, 1 ] // Custom quintic ease-out
                                    } }
                                    className={ `text-5xl font-serif font-semibold tabular-nums ${timeLeft === "Starting..."
                                        ? "text-primary/50 animate-pulse"
                                        : "text-primary text-glow-primary"
                                        }` }
                                >
                                    { char }
                                </motion.span>
                            </AnimatePresence>
                        </div>
                    )) }
                </div>
            </div>
        )
    );
};