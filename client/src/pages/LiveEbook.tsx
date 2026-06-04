import { trackEvent } from "@/lib/analytics";
import { useState, useEffect } from "react";
import { useLiveState } from "@/hooks/use-live-state";
import { SpeakerButton } from "@/components/SpeakerButton";
import { useLocation } from "wouter";
import { useCountdown } from "@shared/hooks/use-countdown";
import { Storyblock } from "@/components/Storyblock";
import { DecisionPhase } from "@/components/DecisionPhase";
import { LiveChat } from "@/components/LiveChat";
import { PushToggle } from "@/components/pwa/PushToggle";
import { Loader2, WifiOff, Users } from "lucide-react";
import { motion } from "framer-motion";
import { DEFAULT_CHANNEL_ID } from "@/App";

// The story zone occupies exactly this fraction of the screen height.
// It is absolutely positioned and NEVER changes size or position —
// no chat state, keyboard, or transition can reach above this boundary.
const STORY_ZONE_HEIGHT = "58dvh";

export default function LiveEbook() {
  const channelId = DEFAULT_CHANNEL_ID;

  const [chatOpen, setChatOpen] = useState(false);
  // Tracks how many px the software keyboard is covering at the bottom of the
  // visual viewport. Derived from window.visualViewport — the only reliable
  // cross-platform way to get keyboard height on mobile.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const {
    isLoading,
    wsConnected,
    username,
    activeSession,
    currentBlock,
    localTimeRemaining,
    localTimeToDecision,
    localInitialTimeToDecision,
    localInitialTimeRemaining,
    localTurnsToNextChoice,
    chatHistory,
    hasVotedCurrent,
    submitChat,
    submitVote,
    voteResults,
    viewerCount,
    mostRecentMessage,
    isSessionLive,
    macroPhase,
    reactions,
    submitReaction,
    ttsIsSpeaking,
    ttsIsPending,
    ttsError,
    ttsToggle,
  } = useLiveState(channelId);

  const [_, setLocation] = useLocation();

  // ── Lobby countdown ─────────────────────────────────────────────────────
  const { timeLeft } = useCountdown(activeSession?.scheduledStart);

  // ── Keyboard height tracking ────────────────────────────────────────────
  // visualViewport fires "resize" on every frame the keyboard animates.
  // We derive keyboard height as the difference between the fixed layout
  // viewport (window.innerHeight) and the shrinking visual viewport.
  // The `bottom` of the bottom zone is set to this value so the zone
  // slides up in perfect sync with the keyboard — zero layout shift.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      setKeyboardHeight(Math.max(0, window.innerHeight - vv.height));
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // ── Session guard ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && wsConnected && !isSessionLive) {
      setLocation("/upcoming");
    }
  }, [isLoading, wsConnected, isSessionLive, setLocation]);

  const handleToggleChat = () => {
    setChatOpen((prev) => !prev);
    trackEvent("Live Chat Toggled", { isOpen: !chatOpen, channel: channelId });
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

  const isGathering = macroPhase === "gathering";
  const isAfterparty = macroPhase === "afterparty";
  const chatForceOpen = isGathering || isAfterparty;
  const isChatEffectivelyOpen = chatOpen || chatForceOpen;

  return (
    <main
      className="fixed inset-0 bg-black text-foreground overflow-hidden overscroll-none"
      // touch-none on the root prevents inadvertent page-level scroll while
      // still allowing the chat message list's own touch handler to fire.
      style={{ touchAction: "none" }}
    >
      {/* ── SEO structured data ──────────────────────────────────────────── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "25th Chapter - Live Story Session",
            description:
              "Join the live 25-minute interactive story session. Read and vote on choose-your-adventure choices with a global book club community.",
            url: "https://25thchapter.com/",
            image: "https://25thchapter.com/preview/1.png",
            datePublished: new Date().toISOString(),
            author: { "@type": "Organization", name: "25th Chapter" },
            publisher: {
              "@type": "Organization",
              name: "25th Chapter",
              logo: {
                "@type": "ImageObject",
                url: "https://25thchapter.com/favicon-32x32.png",
              },
            },
            mainEntity: {
              "@type": "Event",
              name: "Live Story Session",
              eventAttendanceMode:
                "https://schema.org/OnlineEventAttendanceMode",
              eventStatus: "https://schema.org/EventOccurring",
            },
          }),
        }}
      />

      {/* ── Connection warning ───────────────────────────────────────────── */}
      {!wsConnected && (
        <div className="absolute top-0 inset-x-0 z-50 bg-destructive/90 text-destructive-foreground text-xs py-1.5 px-4 flex items-center justify-center gap-2 font-medium">
          <WifiOff className="w-3 h-3" /> Reconnecting to live feed...
        </div>
      )}

      {/* ── Header (overlaid on story zone) ──────────────────────────────── */}
      <header className="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-5 pt-4 pb-2 pointer-events-none">
        <div className="flex items-center gap-1.5 text-muted-foreground pointer-events-auto">
          <Users className="size-3.5" />
          <span className="text-xs font-mono tabular-nums">
            {viewerCount.toLocaleString()}
          </span>
        </div>
        <div className="pointer-events-auto flex items-center gap-1">
          { currentBlock?.content && (
            <SpeakerButton
              isSpeaking={ttsIsSpeaking}
              isPending={ttsIsPending}
              hasError={!!ttsError}
              onClick={() => ttsToggle(currentBlock.dialogue || currentBlock.content)}
            />
          )}
          <PushToggle />
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════════════
          STORY ZONE
          • position: absolute, top: 0, height: STORY_ZONE_HEIGHT
          • This element is fully independent of the chat and keyboard.
          • Nothing can ever overlap it — the bottom zone begins exactly
            where this ends (top: STORY_ZONE_HEIGHT).
         ════════════════════════════════════════════════════════════════════ */}
      <section
        aria-label="Story"
        className="absolute inset-x-0 top-0 overflow-hidden"
        style={{ height: STORY_ZONE_HEIGHT }}
      >
        {isGathering ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-black z-10">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6 max-w-md"
            >
              <h1 className="font-serif font-semibold text-3xl md:text-4xl text-white/90 tracking-tight">
                The Lobby
              </h1>
              <p className="text-white/50 font-sans text-sm">
                You're joining readers from around the world.
                <br />
                You can introduce yourself in the chat. The story begins
                shortly.
              </p>
              {timeLeft && timeLeft !== "Starting..." && (
                <p className="text-xs text-white font-mono tabular-nums tracking-wider">
                  Starting in {timeLeft}
                </p>
              )}
              <div className="h-px w-24 bg-gradient-to-r from-transparent via-white/30 to-transparent mx-auto" />
            </motion.div>
          </div>
        ) : (
          <Storyblock
            block={currentBlock}
            reactions={reactions}
            onReaction={submitReaction}
          />
        )}
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          BOTTOM ZONE
          • Starts at exactly STORY_ZONE_HEIGHT — cannot overlap the story.
          • `bottom` is driven by keyboardHeight (visualViewport API).
            The zone slides up in sync with the keyboard animation with no
            layout shift anywhere else on the page.
          • Contains DecisionPhase (shrink-0) + LiveChat (fills remainder).
         ════════════════════════════════════════════════════════════════════ */}
      <section
        aria-label="Controls"
        className="absolute inset-x-0 flex flex-col overflow-hidden bg-black"
        style={{
          top: STORY_ZONE_HEIGHT,
          bottom: keyboardHeight,
          // Match the OS keyboard animation duration (iOS ~250ms, Android ~220ms)
          transition: "bottom 0.22s ease",
        }}
      >
        {/* Decision phase — always rendered first (top of bottom zone) */}
        { (
          <DecisionPhase
            phase={currentBlock?.phase}
            timeRemaining={localTimeRemaining}
            timeToDecision={localTimeToDecision}
            initialTimeToDecision={localInitialTimeToDecision}
            initialTimeRemaining={localInitialTimeRemaining}
            turnsToNextChoice={localTurnsToNextChoice}
            hasVoted={hasVotedCurrent}
            onVote={submitVote}
            optionA={currentBlock?.optionA}
            optionB={currentBlock?.optionB}
            voteResults={voteResults}
            selectedChoice={
              hasVotedCurrent
                ? (sessionStorage.getItem(
                    `voted_${channelId}_${currentBlock?.id}`,
                  ) as "A" | "B")
                : null
            }
          />
        )}

        {/* Chat — in-flow, expands to fill remaining space when open.
            No position: fixed. Max height is constrained by the bottom zone,
            which starts at STORY_ZONE_HEIGHT — physically impossible to
            overlap the story. */}
        <LiveChat
          history={chatHistory}
          mostRecentMessage={mostRecentMessage}
          username={username}
          onSend={submitChat}
          keepOpen={true}
          isOpen={isChatEffectivelyOpen}
          onToggle={handleToggleChat}
        />
      </section>
    </main>
  );
}
