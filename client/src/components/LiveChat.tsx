import { useState, useRef, useEffect } from 'react';
import { Send, MessageCircle, ChevronDown, UserCircle2 } from 'lucide-react';
import { useLiveState, type ChatMsg } from '@/hooks/use-live-state';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LiveChatProps {
  history: ChatMsg[];
  mostRecentMessage: ChatMsg | null;
  username: string;
  onSend: (text: string) => void;
  isOpen: boolean;
  onToggle: () => void;
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

function formatTime(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 10) return "now";
  if (diff < 60) return `${diff}s`;
  return `${Math.floor(diff / 60)}m`;
}

export function LiveChat({ history, mostRecentMessage, username, onSend, isOpen, onToggle }: LiveChatProps) {
  const [inputText, setInputText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isOpen && bottomRef.current) {
      // Small timeout to ensure DOM layout has updated after AnimatePresence
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  }, [ history, isOpen ]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInputText('');
  };

  // Count unread (messages after chat was closed)
  const [unreadCount, setUnreadCount] = useState(0);
  const lastSeenRef = useRef<number>(0);

  useEffect(() => {
    if (!isOpen && history.length > 0) {
      const latestId = history[history.length - 1].id;
      if (latestId > lastSeenRef.current && lastSeenRef.current > 0) {
        setUnreadCount(prev => prev + 1);
      }
    }
    if (isOpen) {
      if (history.length > 0) {
        lastSeenRef.current = history[history.length - 1].id;
      }
      setUnreadCount(0);
    }
  }, [history, isOpen]);

  return (
    <>
      { (
        <div className="flex justify-between py-5 px-5 gap-5">
          {
              <motion.button
                initial={ { opacity: 0, y: 20 } }
                animate={ { opacity: 1, y: 0 } }
                aria-label="Open chat"
                onClick={ onToggle }
              className="z-50 flex flex-1 border items-center gap-2 bottom-5 left-5 bg-black/80 backdrop-blur-sm  border-white/15 rounded-lg px-3 py-2 h-12 w-12 text-sm"
              >
              { mostRecentMessage ? (
                <>
                <span className="text-primary font-medium">{ mostRecentMessage.username }: </span>
                  <span className="text-white/80">{ mostRecentMessage.text.length > 15 ? mostRecentMessage.text.slice(0, 15) + '...' : mostRecentMessage.text }</span>
                </>
              ) : (
                <span className="flex items-center gap-2 text-primary font-medium justify-center">
                  <MessageCircle className="size-5" />
                  Join The Chat</span>
              ) }
            </motion.button>
          }

          {/* <button
            onClick={ onToggle }
            className="bottom-5 right-5 z-50 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg h-12 w-12 transition-transform hover:scale-105 active:scale-95"
            aria-label="Open chat"
          >
          <MessageCircle className="size-5" />
          {unreadCount > 0 && (
            <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 h-5 min-w-5 text-[10px] px-1"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </button> */}
        </div>
      )}

      {/* Chat drawer - from v0 style */}
      {isOpen && (
        <motion.div 
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-background/95 backdrop-blur-md border-t border-border"
          style={{ height: '50dvh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <MessageCircle className="size-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Live Chat</span>
              <span className="text-xs text-muted-foreground">
                {history.length} messages
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              aria-label="Close chat"
              className="h-8 w-8"
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="flex flex-col gap-1.5 px-4 py-3">
              <AnimatePresence initial={ false } mode="popLayout">
                <>
                  { history.length === 0 ? (
                    <motion.div
                      key="empty"
                      initial={ { opacity: 0 } }
                      animate={ { opacity: 1 } }
                      exit={ { opacity: 0 } }
                      className="text-center text-white/30 italic text-sm py-8"
                    >
                      Be the first to speak...
                    </motion.div>
                  ) : (
                  history.map((msg) => {
                    const isMe = msg.username === username;
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-baseline gap-2 text-sm"
                      >
                        <span
                          className="shrink-0 font-medium text-xs"
                          style={{ color: isMe ? 'hsl(var(--primary))' : getUserColor(msg.username) }}
                        >
                          {isMe ? 'You' : msg.username}
                        </span>
                        <span className="text-foreground/80 break-words min-w-0">
                          {msg.text}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground ml-auto tabular-nums">
                          {formatTime(msg.createdAt)}
                        </span>
                      </motion.div>
                    )
                  })
                  )
                  }
                </>
              </AnimatePresence>
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0"
          >
            <Input
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Say something..."
              className="flex-1 h-12 bg-secondary border-0 text-sm text-foreground placeholder:text-muted-foreground"
              maxLength={200}
              autoComplete="off"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!inputText.trim()}
              className="h-12 w-12"
            >
              <Send className="size-4" />
            </Button>
          </form>
        </motion.div>
      )}
    </>
  );
}
