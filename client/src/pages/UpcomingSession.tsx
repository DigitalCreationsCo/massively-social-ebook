import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { validateSchemaDates } from "@/lib/validateSchema";
import { trackEvent } from "@/lib/analytics";
import { DEFAULT_CHANNEL_ID } from "@/App";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { motion } from "framer-motion";
import { AuthModal } from "@/components/AuthModal";
import { LiveBroadcastSection } from "@/components/LiveBroadcastSection";
import { api } from "@shared/routes";
import type { Channel, Session } from "@shared/schema";

export default function LandingPage() {
  const channelId = DEFAULT_CHANNEL_ID;
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  
  const sessionQuery = useQuery({
    queryKey: [api.sessions.next.path, channelId],
    queryFn: async () => {
      const response = await fetch(`${api.sessions.next.path}?channelId=${encodeURIComponent(channelId)}`);
      if (!response.ok) return null;
      return response.json() as Promise<{ session: Session | null; channel: Channel }>;
    },
    staleTime: 30_000,
  });
  const activeSession = sessionQuery.data?.session ?? null;
  const activeChannel = sessionQuery.data?.channel ?? null;
  const sessionStatus = activeSession?.status ?? "scheduled";

  const featuredSession = activeSession;
  const featuredTitle = featuredSession?.title.split(":").at(-1)?.trim() ?? "Live Broadcast";

  // Construct schema params and validate before creating the full JSON-LD object
  const schemaParams = featuredSession
    ? {
        startDate: new Date(featuredSession.scheduledStart).toISOString(),
        endDate: new Date(featuredSession.scheduledEnd).toISOString(),
        validFrom: new Date().toISOString(),
      }
    : null;

  const isValidSchema = schemaParams
    ? validateSchemaDates(schemaParams)
    : false;

  const jsonLd =
    featuredSession && isValidSchema && schemaParams
      ? {
          "@context": "https://schema.org",
          "@type": "BroadcastEvent",
          name: "The 25th Chapter: Continuous Live Story",
          description: `An AI-generated mystery broadcast unfolding live. Watch ${featuredTitle} now.`,
          url: "https://25thchapter.com",
          image: "https://25thchapter.com/preview/1.png",
          author: { "@type": "Organization", name: "25th Chapter" },
          publisher: {
            "@type": "Organization",
            name: "25th Chapter",
            logo: {
              "@type": "ImageObject",
              url: "https://25thchapter.com/favicon-32x32.png",
            },
          },
          offers: {
            "@type": "Offer",
            url: "https://25thchapter.com",
            price: "0",
            priceCurrency: "USD",
          },
        }
      : null;

  const isLoading = sessionQuery.isLoading;

  const coverImageUrl = activeChannel?.coverImage ?? undefined;

  if (isLoading || sessionStatus === "loading") {
    return (
      <div className="min-h-screen w-full bg-black flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="font-serif font-semibold tracking-widest text-sm text-white/75">
            Loading
          </p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-[#050403] text-foreground selection:bg-primary/30">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BroadcastEvent",
          name: "Massively Social — Live Broadcast",
          description: "Drop into a continuous AI-generated cinematic broadcast and join the live conversation.",
          isLiveBroadcast: true,
        }) }}
      />
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}

      <LiveBroadcastSection channelId={channelId} />

      {/* ═══════════════════════════════════════════════════════════════════
          LANDING PAGE CONTENT (AFTER THE FOLD)
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="min-h-screen w-full bg-black flex flex-col items-center touch-pan-y">
        {/* ═══════════════════════════════════════════════════════════════════
            HERO SECTION
           ═══════════════════════════════════════════════════════════════════ */}
        <section className="relative w-full flex items-center justify-center py-12 px-6 overflow-hidden">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950 via-black to-black" />
          {coverImageUrl && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-[0.08]"
            >
              <img
                src={coverImageUrl}
                alt=""
                className="h-full w-full object-cover scale-105 select-none"
                draggable={false}
              />
            </div>
          )}

          <div className="relative z-10 flex flex-col items-center space-y-10 max-w-4xl w-full">
            {/* Super-title */}
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-xs tracking-[0.4em] text-white font-sans uppercase"
            >
              25th Chapter Presents
            </motion.p>

            {/* Hero Copy */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="relative text-center space-y-6"
            >
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-white/40 to-primary/20 rounded-2xl blur-2xl opacity-60 transition duration-1000 w-full h-full" />
              <h1 className="font-serif font-semibold text-5xl md:text-7xl text-white tracking-tight leading-tight">
                One mystery.
                <br />
                One daily episode.
              </h1>
              <p className="text-white/75 font-sans text-lg max-w-2xl mx-auto leading-relaxed">
                An interactive thriller story in motion.
              </p>
            </motion.div>
          </div>
        </section>

      {/* ═══════════════════════════════════════════════════════════════════
          CHARACTER SECTION
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="w-full px-6 py-24 bg-zinc-950/50">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="max-w-6xl mx-auto"
          >
          <div className="text-center space-y-4 mb-16">
            <h2 className="text-4xl md:text-5xl font-serif font-semibold text-white tracking-tight">
              Follow the investigation
            </h2>
            <p className="text-white/75 max-w-2xl mx-auto font-sans text-lg">
              Every episode uncovers another piece of the conspiracy.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-2xl mx-auto">
            {/* Character 1 */}
            <div className="group order-2 relative aspect-[1/2] overflow-hidden rounded-2xl border border-white/10">
              {/* Background Image */}
              <img
                src="hero1.png"
                alt="Special Agent Nathan Gunn"
                className="absolute inset-0 h-full w-full object-cover opacity-100 transition-opacity duration-700 md:opacity-80 group-hover:opacity-100"
              />

              {/* Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/20" />

              {/* Content */}
              <div className="absolute inset-x-0 bottom-0 p-8">
                <div className="mx-auto text-center">
                <h3 className="text-3xl font-serif font-semibold text-white">
                  Nathan Gunn
                </h3>
                <p className="mt-1 text-sm text-white/75">
                  Federal investigator
                </p>
                </div>
                <p className="mt-5 leading-relaxed">
                  A theft investigation leads him to a mystery that challenge his beliefs.
                </p>
              </div>
            </div>

            {/* Character 2 */}
            <div className="group relative aspect-[1/2] overflow-hidden rounded-2xl border border-white/10">
              {/* Background Image */}
              <img
                src="/hero2.png"
                alt="Claire Cole"
                className="absolute inset-0 h-full w-full object-cover opacity-100 transition-opacity duration-700 md:opacity-80 group-hover:opacity-100"
              />
              {/* Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/20" />
              {/* Content */}
              <div className="absolute inset-x-0 bottom-0 p-8">
                <div className="mx-auto text-center">
                <h3 className="text-3xl font-serif font-semibold text-white">
                  Claire Cole
                </h3>
                <p className="mt-1 text-sm text-white/75">
                  Major crimes detective
                </p>
                </div>
                <p className="mt-5 leading-relaxed">
                  She built her career on seeing what others miss. This case leaves behind evidence she can't explain.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          HOW IT WORKS
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="w-full px-6 py-24 bg-zinc-950/30">
        <div className="max-w-4xl mx-auto">
          <div className="text-center space-y-4 mb-16">
            <p className="text-xs tracking-[0.4em] text-white/75 uppercase">
              How It Works
            </p>
            <h2 className="text-4xl md:text-5xl font-serif font-semibold text-white tracking-tight">
              Take part in the ongoing mystery
            </h2>
          </div>

          <div className="space-y-8">
            {[
              {
                step: "01",
                title: "Enter the live signal",
                description:
                  "The channel broadcasts continuously. Join wherever the story is and stay as long as you like.",
              },
              {
                step: "02",
                title: "Join the conversation",
                description:
                  "Talk with other viewers while messages from the wider stream arrive in the same room.",
              },
              {
                step: "03",
                title: "Catch the scheduled chapters",
                description:
                  "Named episodes become canonical story windows inside the always-on broadcast.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="flex gap-6 items-start p-8 rounded-2xl border border-white/5 bg-black/40 backdrop-blur-sm"
              >
                <span className="text-5xl font-serif font-semibold text-primary/75 flex-shrink-0">
                  {item.step}
                </span>
                <div className="space-y-2">
                  <h3 className="text-2xl font-serif font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="text-white/75 font-sans text-lg">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          FAQ SECTION
         ═══════════════════════════════════════════════════════════════════ */}
      <section id="faq" className="w-full px-6 py-24 bg-zinc-950/50">
        <div className="max-w-2xl mx-auto">
          <div className="text-center space-y-4 mb-16">
            <p className="text-sm text-white/75 font-sans uppercase tracking-widest">
              FAQ
            </p>
            <h2 className="text-4xl md:text-5xl font-serif font-semibold text-white tracking-tight">
              Everything you need to know
            </h2>
          </div>

          <div className="space-y-3">
            {[
              {
    id: "episodes",
    q: "How do episodes work?",
    a: `Stories are released one episode at a time. ${featuredTitle} is available now, and new episodes are released regularly. Each episode takes about 8 minutes to watch.`,
  },
  //  {
  //               id: "choices",
  //               q: "How do choices work?",
  //               a: "At key moments in the story, you make a choice that influences the direction of the narrative. Your decisions are tracked and shape future episodes.",
  //             },
  {
    id: "discussion",
    q: "Can I discuss the story with other readers?",
    a: "Yes. After each episode, you can join the discussion and leave notes on specific moments in the story.",
  },
  {
    id: "following",
    q: "What happens when I follow a story?",
    a: "Following a story lets you track your progress and get notified when new episodes are released.",
  },
  {
    id: "cost",
    q: "Is it free?",
    a: "Episode 1 is always free. Future episodes are free during the launch period. ",
  },
  {
    id: "missed",
    q: "Can I watch older episodes?",
    a: "Yes. Once an episode is released, you can watch it anytime and catch up at your own pace.",
  },
  {
    id: "app",
    q: "Do I need to download an app?",
    a: "No. You can watch in your browser, or add The 25th Chapter to your home screen for an app-like experience.",
  },
            ].map((faq) => (
              <Collapsible
                key={faq.id}
                open={openFaq === faq.id}
                onOpenChange={() =>
                  setOpenFaq(openFaq === faq.id ? null : faq.id)
                }
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 rounded-lg p-4 text-left transition-colors hover:bg-white/5 data-[state=open]:bg-white/5">
                  <h3 className="text-xl font-serif font-semibold text-white">
                    {faq.q}
                  </h3>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-white/75 transition-transform duration-200 ${openFaq === faq.id ? "" : "-rotate-90"}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden transition-all duration-200 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                  <div className="px-4 py-4">
                    <p className="text-white/75 font-sans text-lg leading-relaxed">
                      {faq.a}
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          FINAL CTA
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="relative w-full pt-24 pb-16 px-6 bg-gradient-to-b from-transparent to-zinc-950/80">
        {/* The channel art stays stable while the live stream itself changes. */}
        {coverImageUrl && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-[0.05]"
          >
            <img
              src={coverImageUrl}
              alt=""
              className="h-full w-full object-cover select-none"
              draggable={false}
            />
          </div>
        )}

        <div className="max-w-md mx-auto text-center space-y-8 z-10 relative">
          <div className="space-y-4">
            <h2 className="text-4xl font-serif font-semibold text-white tracking-tight">
              {featuredTitle} is available now.
            </h2>
            </div>
          <div className="max-w-sm mx-auto">
            <Button
              onClick={() => {
                trackEvent("Final CTA Scroll to Player", { channel: channelId });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="w-full bg-primary/90 hover:bg-primary text-primary-foreground font-serif font-semibold tracking-tight text-3xl py-6 shadow-lg transition-all hover:scale-[1.01]"
            >
              Watch {featuredTitle}
            </Button>
            <p className="py-5 text-xs tracking-[0.4em] text-white font-sans uppercase text-center">
              25th Chapter
            </p>
          </div>
          <Button
            variant="ghost"
            className="text-white/50 font-sans leading-relaxed text-center text-base"
            onClick={() => {
              trackEvent("Return to Player Clicked");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Return to player
          </Button>
        </div>
      </section>

    </div>

    {/* ── Auth Modal ───────────────────────────────────────────── */}
    <AuthModal
      open={authModalOpen}
      onOpenChange={setAuthModalOpen}
      defaultMode="login"
    />
    </main>
  );
}
