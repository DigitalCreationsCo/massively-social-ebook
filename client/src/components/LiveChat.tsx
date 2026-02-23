import { useState, useRef, useEffect } from 'react';
import { Send, UserCircle2 } from 'lucide-react';
import type { ChatMsg } from '@/hooks/use-live-state';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface LiveChatProps {
  history: ChatMsg[];
  username: string;
  onSend: (text: string) => void;
}

// Deterministic color generator based on username string
function getUserColor(username: string) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 70%, 65%)`;
}

export function LiveChat({ history, username, onSend }: LiveChatProps) {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInputText('');
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* Chat Messages Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4 scroll-smooth pb-32"
      >
        <AnimatePresence initial={false}>
          {history.length === 0 ? (
            <div className="h-full flex items-center justify-center text-white/30 italic text-sm">
              Be the first to speak...
            </div>
          ) : (
            history.map((msg) => {
              const isMe = msg.username === username;
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.2 }}
                  className={cn(
                    "flex flex-col max-w-[85%]",
                    isMe ? "ml-auto items-end" : "mr-auto items-start"
                  )}
                >
                  <span 
                    className="text-xs font-medium mb-1 px-1 opacity-80"
                    style={{ color: isMe ? 'hsl(var(--primary))' : getUserColor(msg.username) }}
                  >
                    {isMe ? 'You' : msg.username}
                  </span>
                  <div 
                    className={cn(
                      "px-4 py-2 rounded-2xl text-sm leading-relaxed",
                      isMe 
                        ? "bg-primary/20 text-white border border-primary/30 rounded-tr-sm" 
                        : "bg-white/5 text-white/90 border border-white/5 rounded-tl-sm"
                    )}
                  >
                    {msg.text}
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Input Area (Fixed at bottom of this flex container) */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black via-black to-transparent pt-8">
        <form 
          onSubmit={handleSubmit}
          className="flex items-center gap-2 max-w-4xl mx-auto bg-white/10 p-1.5 rounded-full border border-white/10 backdrop-blur-md focus-within:border-primary/50 focus-within:bg-white/15 transition-colors"
        >
          <div className="pl-3 hidden sm:flex items-center justify-center text-white/40">
            <UserCircle2 className="w-5 h-5" />
          </div>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Discuss the story..."
            className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/40 text-sm px-3 py-2"
            maxLength={200}
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
