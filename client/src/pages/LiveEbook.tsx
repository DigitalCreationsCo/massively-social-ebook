import { trackEvent } from "@/lib/analytics";
import { useState, useEffect, useRef } from "react";
import { useLiveState } from "@/hooks/use-live-state";
import { SpeakerButton } from "@/components/SpeakerButton";
import { useLocation } from "wouter";
import { Storyblock } from "@/components/Storyblock";
import { LiveChat } from "@/components/LiveChat";
import { DecisionPhase } from "@/components/DecisionPhase";
import { PushToggle } from "@/components/pwa/PushToggle";
import { Loader2, WifiOff, MessageCircle, ArrowLeft, BookOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DEFAULT_CHANNEL_ID } from "@/App";
import { Button } from "@/components/ui/button";

// The story zone occupies exactly this fraction of the screen height.
const STORY_ZONE_HEIGHT = "58dvh";

export default function LiveEbook() {
  const channelId = DEFAULT_CHANNEL_ID;

  const {
    isLoading,
    wsConnected,
    username,
    activeSession,
    allBlocks,
    currentBlock,
    currentBlockIndex,
    advanceToNextBlock,
    chatHistory,
    mostRecentMessage,
    submitChat,
    reactions,
    submitReaction,
    viewerCount,
    isSessionLive,
    macroPhase,
    ttsIsSpeaking,
    ttsIsPending,
    ttsError,
    ttsToggle,
  } = useLiveState(channelId);

  const [_, setLocation] = useLocation();
  const [chatOpen, setChatOpen] = useState(false);
  const [showEpisodeComplete, setShowEpisodeComplete] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Session guard ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && wsConnected && !isSessionLive) {
      setLocation("/");
    }
  }, [isLoading, wsConnected, isSessionLive, setLocation]);

  // ── Auto-advance timer ──────────────────────────────────────────────────
  const READING_SEGMENT_MS = 25_000;
  const SKIP_AFTER_MS = 11_000;

  useEffect(() => {
    if (allBlocks.length === 0) return;
    if (currentBlockIndex >= allBlocks.length - 1) {
      // Track when we're on the last block — show episode complete after it
      const completeTimer = setTimeout(() => {
        setShowEpisodeComplete(true);
      }, READING_SEGMENT_MS);
      return () => clearTimeout(completeTimer);
    }

    let canSkip = false;

    // After 11s, user can tap to advance
    skipTimerRef.current = setTimeout(() => {
      canSkip = true;
    }, SKIP_AFTER_MS);

    // Auto-advance after 25s no matter what
    timerRef.current = setInterval(() => {
      advanceToNextBlock();
      setShowEpisodeComplete(false);
      clearInterval(timerRef.current!);
    }, READING_SEGMENT_MS);

    return () => {
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentBlockIndex, allBlocks.length, advanceToNextBlock]);

  // ── Tap to advance (only after 11s) ────────────────────────────────────
  const isLastBlock =
    allBlocks.length > 0 && currentBlockIndex >= allBlocks.length - 1;

  const handleStoryTap = () => {
    if (isLastBlock) {
      setShowEpisodeComplete(true);
      return;
    }
    advanceToNextBlock();
    trackEvent("Block Manually Advanced", {
      channel: channelId,
      blockIndex: currentBlockIndex,
    });
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
        <p className="font-serif tracking-widest text-sm text-white/60">
          Loading
        </p>
      </div>
    );
  }

  // ── No session available ───────────────────────────────────────────────
  if (!activeSession || allBlocks.length === 0) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.1 }}
        className="fixed inset-0 bg-black flex flex-col items-center justify-center p-6"
        >
        <div className="text-center space-y-6 max-w-md">
          <BookOpen className="w-16 h-16 mx-auto" />
          <h1 className="font-serif font-semibold text-4xl text-white tracking-tight">
            No Episode Available
          </h1>
          <p className="text-white/50 font-sans text-lg">
            There's no active episode right now. Check back when a new episode
            is released.
          </p>
          <Button
            onClick={() => setLocation("/")}
            className="bg-primary/90 hover:bg-primary text-primary-foreground"
          >
            Back to Home
          </Button>
        </div>
      </motion.div>
    );
  }

  const totalBlocks = allBlocks.length;
  const isComplete = showEpisodeComplete || macroPhase === "afterparty";
  const progressPercent =
    totalBlocks > 0 ? ((currentBlockIndex + 1) / totalBlocks) * 100 : 0;

  return (
    <main
      className="fixed inset-0 bg-black text-foreground overflow-hidden overscroll-none"
      style={{ touchAction: "none" }}
    >
      {/* ── SEO structured data ──────────────────────────────────────────── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "25th Chapter - Reading",
            description: "Read the latest episode of this interactive thriller.",
            url: "https://25thchapter.com/read",
          }),
        }}
      />

      {/* ── Connection warning ───────────────────────────────────────────── */}
      {!wsConnected && (
        <div className="absolute top-0 inset-x-0 z-50 bg-destructive/90 text-destructive-foreground text-xs py-1.5 px-4 flex items-center justify-center gap-2 font-medium">
          <WifiOff className="w-3 h-3" /> Reconnecting to live feed...
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-5 pt-4 pb-2 pointer-events-none">
        <div className="pointer-events-auto">
          <button
            onClick={() => setLocation("/")}
            className="text-white/40 hover:text-white/70 transition-colors"
            aria-label="Back to home"
          >
            <ArrowLeft className="size-5" />
          </button>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground pointer-events-auto">
          {/* Episode indicator */}
          <span className="text-xs font-mono tabular-nums text-white/40">
            {currentBlockIndex + 1}/{totalBlocks}
          </span>
          {/* TTS */}
          {currentBlock?.content && (
            <SpeakerButton
              isSpeaking={ttsIsSpeaking}
              isPending={ttsIsPending}
              hasError={!!ttsError}
              onClick={() =>
                ttsToggle(
                  currentBlock.dialogue || currentBlock.content,
                )
              }
            />
          )}
          <PushToggle />
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════════════
          STORY ZONE
         ════════════════════════════════════════════════════════════════════ */}
      <section
        aria-label="Story"
        className="absolute inset-x-0 top-0 overflow-hidden cursor-pointer"
        style={{ height: STORY_ZONE_HEIGHT }}
        onClick={handleStoryTap}
      >
        <Storyblock
          block={currentBlock ?? undefined}
          reactions={reactions}
          onReaction={submitReaction}
        />

        {/* ── Progress bar overlay ──────────────────────────────── */}
        <div className="absolute bottom-0 inset-x-0 h-1 bg-white/10 z-20">
          <motion.div
            className="h-full bg-primary/60"
            initial={{ width: `${progressPercent}%` }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ ease: "linear", duration: 0.3 }}
          />
        </div>

        {/* ── Tap to continue hint ──────────────────────────────── */}
        {!isLastBlock && !isComplete && (
          <div className="absolute bottom-4 inset-x-0 flex justify-center z-20 pointer-events-none">
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.5, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-xs text-white/30 font-sans tracking-wider uppercase"
            >
              Tap to continue
            </motion.p>
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          BOTTOM ZONE
         ════════════════════════════════════════════════════════════════════ */}
      <section
        aria-label="Controls"
        className="absolute inset-x-0 flex flex-col overflow-hidden bg-black"
        style={{
          top: "50dvh",
        }}
      >
        {/* ── Episode Complete Banner ────────────────────────────── */}
        <AnimatePresence>
          {isComplete && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex-shrink-0 border-t border-primary/20 bg-gradient-to-b from-primary/5 to-transparent"
            >
              <div className="px-6 py-6 text-center space-y-3">
                <h2 className="font-serif font-semibold text-2xl text-white tracking-tight">
                  Episode Complete
                </h2>
                <p className="text-white/50 font-sans text-sm">
                  {activeSession?.title
                    ? `You've finished "${activeSession.title}".`
                    : "You've finished this episode."}
                </p>
                <p className="text-white/40 font-sans text-xs">
                  Join the discussion below. New episode arrives tomorrow.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Reading progress bar ──────────────────────────────── */}
        <DecisionPhase progressPercent={progressPercent} />

        {/* ── Chat ───────────────────────────────────────────────── */}
        <LiveChat
          history={chatHistory ?? []}
          mostRecentMessage={mostRecentMessage}
          username={username}
          onSend={submitChat}
          isOpen={chatOpen}
          keepOpen={isComplete}
          onToggle={() => {
            if (!isComplete) {
              setChatOpen((prev) => !prev);
            }
          }}
        />
      </section>
    </main>
  );
}
