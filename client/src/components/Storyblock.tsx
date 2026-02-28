import { motion, AnimatePresence } from 'framer-motion';
import type { StoryState } from '@/hooks/use-live-state';
import type { Reaction } from '@shared/schema';
import { BookOpen, Heart } from 'lucide-react';
import { useEffect, useState } from 'react';

interface StoryblockProps {
  block?: StoryState;
  reactions?: Reaction[];
  onReaction?: (blockId: number, emoji: string, paragraphIndex: number) => void;
}

const ReactionParticle = ({ emoji, id }: { emoji: string; id: number }) => (
  <motion.div
    layoutId={`reaction-${id}`}
    initial={{ opacity: 0, y: 10, scale: 0.5, x: 0 }}
    animate={{ 
      opacity: [0, 1, 0], 
      y: -100, 
      scale: [0.5, 1.5, 1],
      x: (Math.random() - 0.5) * 40
    }}
    transition={{ duration: 2, ease: "easeOut" }}
    className="absolute bottom-0 text-2xl pointer-events-none select-none z-50"
    style={{ left: `${50 + (Math.random() - 0.5) * 20}%` }}
  >
    {emoji}
  </motion.div>
);

export function Storyblock({ block, reactions = [], onReaction }: StoryblockProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!block) {
    return (
      <div className="absolute inset-0 flex items-center justify-end bg-black">
        <motion.div 
          animate={{ opacity: [0.5, 1, 0.5] }} 
          transition={{ duration: 2, repeat: Infinity }}
          className="flex flex-col items-center gap-4 text-primary/60"
        >
          <BookOpen className="w-12 h-12" />
          <p className="font-serif text-lg tracking-widest uppercase">Awaiting Story</p>
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
               className="w-full h-full object-cover object-center opacity-60"
             />
          ) : (
             <div className="w-full h-full bg-gradient-to-br from-zinc-900 to-black" />
          )}

          {/* Dark Gradient Overlay to ensure text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent" />

          {/* Narrative Text Content */}
          <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-12 pb-12 overflow-y-auto no-scrollbar">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 1 }}
              className="max-w-3xl mx-auto w-full"
            >
              {block.title && (
                <h2 className="font-serif text-lg sm:text-xl md:text-2xl font-semibold tracking-tight text-white/95 mb-4 text-glow drop-shadow-xl">
                  {block.title}
                </h2>
              ) }
              
              <div className="space-y-6">
                {block.content.split('\n').filter(Boolean).map((paragraph, idx) => (
                  <div 
                    key={`${block.id}-${idx}`}
                    className="relative group cursor-pointer"
                    onClick={() => onReaction?.(block.id, '❤️', idx)}
                  >
                    <p className="font-serif text-xl sm:text-2xl md:text-3xl leading-relaxed text-white/95 text-glow drop-shadow-xl whitespace-pre-wrap transition-opacity duration-300 group-hover:opacity-80">
                      {paragraph}
                    </p>
                    
                    {/* Interaction Hint */}
                    <div className="absolute -right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <Heart className="w-5 h-5 text-white/50 animate-pulse" />
                    </div>

                    {/* Active Reactions */}
                    <AnimatePresence>
                      {reactions
                        .filter(r => 
                          r.blockId === block.id && 
                          r.paragraphIndex === idx && 
                          (now - new Date(r.createdAt).getTime() < 3000)
                        )
                        .map(r => (
                          <ReactionParticle key={r.id} emoji={r.emoji} id={r.id} />
                        ))
                      }
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
