import { motion, AnimatePresence } from "framer-motion";
import { trackEvent } from "@/lib/analytics";
import type { StoryState } from "@/hooks/use-live-state";
import type { Reaction } from "@shared/schema";
import { BookOpen, Heart } from "lucide-react";
import { useEffect, useState } from "react";

interface StoryblockProps {
  block?: StoryState;
  reactions?: Reaction[];
  onReaction?: (
    blockId: number,
    emoji: string,
    paragraphIndex?: number,
  ) => void;
}

const ReactionParticle = ({ emoji, id }: { emoji: string; id: number }) => (
  <motion.div
    layoutId={`reaction-${id}`}
    initial={{ opacity: 0, y: 10, scale: 0.5, x: 0 }}
    animate={{
      opacity: [0, 1, 0],
      y: -100,
      scale: [0.5, 1.5, 1],
      x: (Math.random() - 0.5) * 40,
    }}
    transition={{ duration: 2, ease: "easeOut" }}
    className="absolute bottom-0 text-2xl pointer-events-none select-none z-50"
    style={{ left: `${50 + (Math.random() - 0.5) * 20}%` }}
  >
    {emoji}
  </motion.div>
);

export function Storyblock({
  block,
  reactions = [],
  onReaction,
}: StoryblockProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!block) {
    return (
      <div className="absolute inset-0 mx-auto flex items-center  bg-black">
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="flex flex-col items-center gap-4"
        >
          <p className="font-serif font-semibold text-lg text-primary tracking-tight">Loading</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-black overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={block.id}
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          className="absolute inset-0"
        >
          {/* Background Image */}
          {block.imageUrl ? (
            <img
              src={block.imageUrl}
              alt="Story visual"
              className="w-full h-full object-cover object-center"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-zinc-900 to-black" />
          )}

          {/* Dark Gradient Overlay to ensure text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black" />

          {/* Narrative Text Content */}
          <div className="absolute inset-0 flex flex-col justify-center p-6 md:p-12 overflow-y-auto no-scrollbar">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 1 }}
              className="max-w-3xl mx-auto w-full"
              // onClick={() => {
              //   onReaction?.(block.id, "❤️");
              //   trackEvent("Story Paragraph Clicked", {
              //     blockId: block.id,
              //     channelId: block?.channelId,
              //   });
              // }}
            >
              <div className="flex items-center gap-4 text-center">
                {block.title && (
                  <h2 className="font-serif leading-none my-4 text-center w-full text-3xl md:text-3xl font-semibold tracking-tight text-white/95 mb-4 text-glow drop-shadow-xl">
                    {block.title}
                  </h2>
                )}

                {/* Interaction Hint */}
                {/*<div className="transition-opacity duration-300">
                  <Heart className="w-6 h-6 text-white/50" />
                </div>*/}
              </div>

              <div className="space-y-6">
                {block.content
                  .split("\n")
                  .filter(Boolean)
                  .map((paragraph, idx) => (
                    <div
                      key={`${block.id}-${idx}`}
                      className="relative group cursor-pointer"
                    >
                      <p className="font-serif font-semibold text-2xl tracking-tight leading-relaxed text-white/95 text-glow drop-shadow-xl whitespace-pre-wrap transition-opacity duration-300 group-hover:opacity-80">
                        {paragraph}
                      </p>

                      {/* Active Reactions */}
                      <AnimatePresence>
                        {reactions
                          .filter(
                            (r) =>
                              r.blockId === block.id &&
                              r.paragraphIndex === idx &&
                              now -
                                new Date(r.createdAt || Date.now()).getTime() <
                                3000,
                          )
                          .map((r) => (
                            <ReactionParticle
                              key={r.id}
                              emoji={r.emoji}
                              id={r.id}
                            />
                          ))}
                      </AnimatePresence>
                    </div>
                  ))}
              </div>
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
