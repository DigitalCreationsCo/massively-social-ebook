import { useState, useRef, useEffect } from "react";
import { ArrowUp, ChevronDown, MessageCircle } from "lucide-react";
import type { ChatMessage } from "@/hooks/use-live-state";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LiveChatProps {
  history: ChatMessage[];
  mostRecentMessage: ChatMessage | null;
  username: string;
  onSend: (text: string) => void;
  isOpen: boolean;
  keepOpen: boolean;
  onToggle: () => void;
}

// Deterministic color per username — consistent across renders
function getUserColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 65%, 68%)`;
}

export function LiveChat({
  history,
  mostRecentMessage,
  username,
  onSend,
  isOpen,
  keepOpen,
  onToggle,
}: LiveChatProps) {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const isEffectivelyOpen = isOpen || keepOpen;
  const isClosable = !keepOpen;

  // ── Auto-scroll to newest message ──────────────────────────────────────
  // requestAnimationFrame defers the scroll until after framer-motion has
  // updated the DOM, preventing a scroll-before-paint glitch.
  useEffect(() => {
    if (!isEffectivelyOpen) return;
    const raf = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [history, isEffectivelyOpen]);

  // ── Focus input when chat opens ────────────────────────────────────────
  // Small delay lets the spring animation settle before triggering the
  // keyboard (avoids a race on iOS that can mis-position the viewport).
  useEffect(() => {
    if (!isEffectivelyOpen) return;
    const t = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(t);
  }, [isEffectivelyOpen]);

  // ── Unread counter ──────────────────────────────────────────────────────
  const [unreadCount, setUnreadCount] = useState(0);
  const lastSeenIdRef = useRef<number>(Infinity);

  useEffect(() => {
    if (!isEffectivelyOpen && history.length > 0) {
      const latestId = history[history.length - 1].id;
      if (latestId > lastSeenIdRef.current && lastSeenIdRef.current > 0) {
        setUnreadCount((n) => n + 1);
      }
    }
    if (isEffectivelyOpen) {
      if (history.length > 0) {
        lastSeenIdRef.current = history[history.length - 1].id;
      }
      setUnreadCount(0);
    }
  }, [history, isEffectivelyOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInputText("");
  };

  return (
    // ── Chat wrapper ────────────────────────────────────────────────────
    // This element is a flex child inside the bottom zone (see LiveEbook).
    //
    // Closed → fixed peek-bar height (44px, flex-shrink: 0).
    // Open   → flex: 1, min-height: 0 so it fills all remaining space
    //          in the bottom zone without overflowing.
    //
    // framer-motion `layout` animates the height transition between states
    // using a spring — no JS height calculations, no CSS max-height hacks.
    // The story zone above is completely unaffected.
    <motion.div
      layout
      className={cn(
        "flex flex-col overflow-hidden",
        "border-t border-white/[0.07]",
        isEffectivelyOpen
          ? "flex-1 min-h-0" // fills remaining space in bottom zone
          : "flex-shrink-0", // collapses to peek-bar height
      )}
      style={!isEffectivelyOpen ? { height: 44 } : undefined}
      transition={{ type: "spring", damping: 32, stiffness: 280, mass: 0.9 }}
    >
      {/* ── Peek bar / Chat header ──────────────────────────────────────
          When closed: shows latest message as a teaser + unread count.
          When open:   shows "Live Chat" label with close affordance.
          Height is always exactly 44px (h-11) — acts as the toggle target.
         ────────────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={isClosable ? onToggle : undefined}
        className={cn(
          "flex-shrink-0 h-11 w-full flex items-center gap-2.5 px-5 text-left",
          "border-b border-white/[0.05]",
          isClosable
            ? "cursor-pointer active:bg-white/[0.03] transition-colors"
            : "cursor-default",
        )}
        aria-label={
          isEffectivelyOpen && isClosable ? "Close live chat" : "Open live chat"
        }
        aria-expanded={isEffectivelyOpen}
      >
        {/* Live pulse dot */}
        <span
          className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary"
          style={{
            animation: "livePulse 2.4s ease-in-out infinite",
          }}
          aria-hidden="true"
        />

        {isEffectivelyOpen ? (
          // Open state: label
          <>
            <span className="flex-1 text-[11px] font-medium tracking-[0.12em] uppercase text-white/50">
              Live Chat
              {isClosable && (
                <span className="text-white/20 font-normal normal-case tracking-normal">
                  {" "}
                  · tap to close
                </span>
              )}
            </span>
            {isClosable && (
              <ChevronDown
                className="size-3.5 text-white/25 flex-shrink-0"
                aria-hidden="true"
              />
            )}
          </>
        ) : (
          // Closed state: message teaser
          <>
            {mostRecentMessage ? (
              <>
                <span
                  className="flex-shrink-0 text-xs font-semibold"
                  style={{ color: getUserColor(mostRecentMessage.username) }}
                >
                  {mostRecentMessage.username}:
                </span>
                <span className="flex-1 text-xs text-white/45 truncate min-w-0">
                  {mostRecentMessage.text}
                </span>
              </>
            ) : (
              <>
                <MessageCircle
                  className="size-3.5 text-white/30 flex-shrink-0"
                  aria-hidden="true"
                />
                <span className="flex-1 text-xs text-white/35">
                  Join the chat
                </span>
              </>
            )}

            {/* Unread badge */}
            {unreadCount > 0 && (
              <span className="flex-shrink-0 text-[10px] font-mono bg-primary/15 text-primary rounded-full px-1.5 py-0.5 leading-none">
                +{unreadCount > 99 ? "99" : unreadCount}
              </span>
            )}

            {/* Chevron pointing up = "open chat" */}
            <ChevronDown
              className="size-3.5 text-white/20 flex-shrink-0 rotate-180"
              aria-hidden="true"
            />
          </>
        )}
      </button>

      {/* ── Message list ───────────────────────────────────────────────────
          Only rendered when open. flex-1 + min-h-0 lets it fill space.

          Scroll is LOCKED to this container only:
          • overflow-y: auto — scrollable
          • overscroll-behavior: contain — prevents page scroll bleed
          • touchAction: pan-y — mobile scroll stays inside this element
          • onTouchMove stopPropagation — belt-and-suspenders for older iOS
         ────────────────────────────────────────────────────────────── */}
      {isEffectivelyOpen && (
        <>
          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
            style={{ touchAction: "pan-y" }}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-2 px-5 py-4">
              <AnimatePresence initial={false} mode="popLayout">
                {history.length === 0 ? (
                  <motion.p
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center text-white/50 text-sm py-8"
                  >
                    Be the first to speak.
                  </motion.p>
                ) : (
                  history.map((msg) => {
                    const isMe = msg.username === username;
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        className="flex items-baseline gap-1.5"
                      >
                        <span
                          className="flex-shrink-0 text-[11px] font-semibold leading-relaxed"
                          style={{
                            color: isMe
                              ? "hsl(var(--primary))"
                              : getUserColor(msg.username),
                          }}
                        >
                          {isMe ? "You" : msg.username}
                        </span>
                        <span className="text-[13px] text-white/65 break-words min-w-0 leading-relaxed">
                          {msg.text}
                        </span>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>

              {/* Scroll anchor — scrollIntoView target */}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
          </div>

          {/* ── Input bar ──────────────────────────────────────────────────
              flex-shrink-0 keeps it pinned to the bottom of the chat panel.
              The bottom zone's `bottom: keyboardHeight` (set in LiveEbook)
              ensures this sits precisely above the software keyboard with
              zero extra calculations needed here.
             ────────────────────────────────────────────────────────────── */}
          <form
            onSubmit={handleSubmit}
            className="flex-shrink-0 flex items-center gap-4 p-5 pr-4"
          >
            <Input
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Say something…"
              className={cn("flex-1", "h-12")}
              maxLength={200}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="sentences"
              spellCheck={false}
              enterKeyHint="send"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!inputText.trim()}
              className={cn(
                "flex-shrink-0 h-12 w-12 p-0! m-0!",
                "bg-primary/10 text-white",
                "disabled:opacity-20 disabled:bg-transparent disabled:border border-none",
                "transition-all duration-150",
              )}
              aria-label="Send message"
            >
              <ArrowUp className="" />
            </Button>
          </form>
        </>
      )}

      {/* Keyframe for the live-pulse dot — injected once */}
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </motion.div>
  );
}
