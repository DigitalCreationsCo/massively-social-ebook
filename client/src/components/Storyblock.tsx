import { motion, AnimatePresence } from 'framer-motion';
import type { StoryState } from '@/hooks/use-live-state';
import { BookOpen } from 'lucide-react';

interface StoryblockProps {
  block?: StoryState;
}

export function Storyblock({ block }: StoryblockProps) {
  if (!block) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
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
              {/* Title from v0 style */}
              {block.title && (
                <h2 className="font-serif text-lg sm:text-xl md:text-2xl font-semibold tracking-tight text-white/95 mb-4 text-glow drop-shadow-xl">
                  {block.title}
                </h2>
              )}
              {/* Story content with serif font from replit */}
              <p className="font-serif text-xl sm:text-2xl md:text-3xl leading-relaxed text-white/95 text-glow drop-shadow-xl whitespace-pre-wrap">
                {block.content}
              </p>
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
