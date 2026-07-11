import { trackEvent } from "@/lib/analytics";
import { useState, useEffect } from "react";
import { useLiveState } from "@/hooks/use-live-state";
import { SpeakerButton } from "@/components/SpeakerButton";
import { useLocation } from "wouter";
import { Storyblock } from "@/components/Storyblock";
import { DecisionPhase } from "@/components/DecisionPhase";
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
    hasVotedCurrent,
    submitVote,
    voteResults,
    viewerCount,
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

  // ── Session guard ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && wsConnected && !isSessionLive) {
      setLocation("/upcoming");
    }
  }, [isLoading, wsConnected, isSessionLive, setLocation]);

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
                The story begins shortly.
              </p>
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
          • Contains DecisionPhase only.
         ════════════════════════════════════════════════════════════════════ */}
      <section
        aria-label="Controls"
        className="absolute inset-x-0 flex flex-col overflow-hidden bg-black"
        style={{
          top: "50dvh",
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
      </section>
    </main>
  );
}
