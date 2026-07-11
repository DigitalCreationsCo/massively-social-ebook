import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useLiveState } from "@/hooks/use-live-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { ChevronDown } from "lucide-react";
import { formatInTZ, isTodayInTZ, isTomorrowInTZ } from "@shared/date";
import { api } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { validateSchemaDates } from "@/lib/validateSchema";
import { trackEvent } from "@/lib/analytics";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_CHANNEL_ID } from "@/App";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
} from "framer-motion";
import { useSessionReplay } from "@shared/hooks/use-session-replay";
import { Replay } from "@shared/components/Replay";
import { cn } from "@/lib/utils";

const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function getTimezoneDisplay(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: tz,
      timeZoneName: "longGeneric",
    }).formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    return tzPart?.value || tz;
  } catch {
    return tz;
  }
}

export function getTimezoneAbbr(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    return tzPart?.value || "";
  } catch {
    return "";
  }
}

function CoverImage({
  src,
  className,
  parallaxSpeed = 0,
  parallaxDirection = "up",
}: {
  src?: string;
  className?: string | string[];
  parallaxSpeed?: number;
  parallaxDirection?: "up" | "down";
}) {
  const { scrollY } = useScroll();
  const direction = parallaxDirection === "up" ? -1 : 1;
  const y = useTransform(
    scrollY,
    (latest) => latest * parallaxSpeed * direction,
  );

  if (!src) return null;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 z-0 overflow-hidden",
        className,
      )}
    >
      <motion.img
        src={src}
        alt=""
        className="
                      h-full
                      w-full
                      object-cover
                      opacity-[0.1]
                      scale-105
                      select-none
                  "
        draggable={false}
        style={{ y }}
      />
    </div>
  );
}

function ReadEpisodeButton({
  className,
}: {
  className?: string | string[];
}) {
  const [_, setLocation] = useLocation();

  return (
    <Button
      onClick={() => setLocation("/")}
      className={cn(
        "w-full bg-primary/90 hover:bg-primary text-primary-foreground font-serif font-semibold tracking-tight text-3xl py-10 shadow-[0_0_30px_rgba(var(--primary),0.2)] transition-all hover:scale-[1.01]",
        className,
      )}
    >
      Read Episode 1
    </Button>
  );
}

export default function UpcomingSession() {
  const channelId = DEFAULT_CHANNEL_ID;
  const {
    sessionStatus,
    activeSession: nextSession,
    isLoading: isLiveSessionLoading,
    wsConnected,
    isSessionLive,
    activeChannel,
  } = useLiveState(channelId);
  const [_, setLocation] = useLocation();
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  const {
    session: previousSession,
    blocks: previousBlocks,
    isLoading: isReplayLoading,
  } = useSessionReplay({ channelId, notableOnly: true, tailFocus: {} });

  const previousSessionExists =
    previousSession && previousBlocks && previousBlocks.length > 0;

  const replayRef = useRef<HTMLDivElement>(null);

  // Construct schema params and validate before creating the full JSON-LD object
  const schemaParams = nextSession
    ? {
        startDate: new Date(nextSession.scheduledStart).toISOString(),
        endDate: new Date(nextSession.scheduledEnd).toISOString(),
        validFrom: new Date().toISOString(),
      }
    : null;

  const isValidSchema = schemaParams
    ? validateSchemaDates(schemaParams)
    : false;

  const jsonLd =
    nextSession && isValidSchema && schemaParams
      ? {
          "@context": "https://schema.org",
          "@type": "Event",
          alternateName: "25th Chapter",
          url: "https://25thchapter.com/",
          name: "The 25th Chapter: Daily Live Story",
          description:
            "Your Daily 25-minute read. Join a global community to read today's featured story together.",
          image: "https://25thchapter.com/preview/1.png",
          startDate: schemaParams.startDate,
          endDate: schemaParams.endDate,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
          location: {
            "@type": "VirtualLocation",
            url: "https://25thchapter.com",
          },
          offers: {
            "@type": "Offer",
            url: "https://25thchapter.com/upcoming",
            price: "0",
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
            validFrom: schemaParams.validFrom,
          },
          performer: {
            "@type": "Person",
            name: "Featured Author",
          },
          organizer: {
            "@type": "Organization",
            name: "The 25th Chapter",
            url: "https://25thchapter.com",
          },
          featureList: [
            "Live interactive storytelling",
            "Choose-your-adventure voting",
            "Real-time chat with readers",
            "Daily 6pm PST story sessions",
            "25-minute reading experience",
            "Social book club community",
            "Mobile PWA installation",
          ],
        }
      : null;

  const isLoading = isLiveSessionLoading || isReplayLoading;

  const coverImageUrl = activeChannel?.coverImage ?? null;

  const randomIndexBlockWithImage = useMemo(() => {
    const validIndexes = (previousBlocks ?? [])
      .map((block, index) => (block?.imageUrl ? index : -1))
      .filter((index) => index !== -1);

    if (validIndexes.length === 0) {
      return -1;
    }

    return validIndexes[Math.floor(Math.random() * validIndexes.length)];
  }, [previousBlocks]);

  if (isLoading || sessionStatus === "loading") {
    return (
      // <div className="h-[100dvh] w-full bg-black flex flex-col items-center justify-center text-primary">
      //     <Loader2 className="w-10 h-10 animate-spin mb-4" />
      //     <p className="font-serif font-semibold tracking-widest text-sm text-white/60">Loading</p>
      // </div>
      <></>
    );
  }

  // if (sessionStatus === 'active') {
  //     return (
  //         <div className="h-screen w-full bg-black flex flex-col items-center justify-center p-6 text-center">
  //             <div className="max-w-md space-y-6">
  //                 <BookOpen className="w-16 h-16 text-primary mx-auto animate-pulse" />
  //                 <h1 className="text-4xl font-serif font-semibold text-white tracking-tight">The Room Is Open</h1>
  //                 <p className="text-white/60 font-serif">Starting...</p>
  //                 <Button
  //                     onClick={() => setLocation('/')}
  //                     className="w-full bg-primary hover:bg-primary/80 text-primary-foreground font-sans uppercase tracking-widest py-6"
  //                 >
  //                     Join
  //                 </Button>
  //             </div>
  //         </div>
  //     );
  // }

  return (
    <div className="min-h-screen w-full bg-black flex flex-col items-center touch-pan-y">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}

      <CoverImage src={coverImageUrl} className="scale-[95%] opacity-[0.5]" />

      {/* Hero Section */}
      <section className="relative min-h-screen max-w-6xl w-full flex items-center justify-center py-12 px-6 mb-12 overflow-hidden">
        <div className="flex flex-col items-center space-y-12 max-w-4xl w-full">
          {/* Hero Copy */}
          <div className="text-center space-y-6 z-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <h1 className="font-serif font-semibold text-5xl md:text-7xl text-white/90 tracking-tight leading-tight">
                One episode.
                <br />
                One mystery.
                <br />
                Start now.
              </h1>
            </motion.div>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-white/60 font-sans text-lg md:text-xl max-w-2xl mx-auto leading-relaxed"
            >
              Premium interactive thrillers released one episode at a time.
              <br />
              Read immediately.
              <br />
              Follow for the next release.
            </motion.p>
          </div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="w-full max-w-md"
          >
            <ReadEpisodeButton />
          </motion.div>

          {/* Phone Mockup */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="relative group flex justify-center"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20 rounded-2xl blur-2xl opacity-60 transition duration-1000 w-full h-full"></div>
            <img
              src="/preview/1.png"
              alt="The 25th Chapter Reading Experience"
              className="relative h-full w-auto object-contain rounded-xl border border-white/5 shadow-3xl bg-zinc-900 max-h-[60vh]"
            />
          </motion.div>
        </div>
      </section>

      {/* Character Section */}
      <section className="w-full min-h-screen px-6 py-24 bg-zinc-950/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center space-y-4 mb-16">
            <p className="text-xs tracking-[0.4em] text-primary/60 uppercase">
              The Investigators
            </p>
            <h2 className="text-4xl md:text-5xl font-serif font-semibold text-white tracking-tight">
              Meet the protagonists
            </h2>
            <p className="text-white/50 max-w-2xl mx-auto font-sans text-lg">
              Every episode uncovers another piece of the conspiracy.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Character 1 */}
            <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 backdrop-blur-sm">
              <div className="aspect-[3/4] bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
                <div className="text-center space-y-4 p-8">
                  <div className="w-32 h-32 mx-auto rounded-full bg-white/5 flex items-center justify-center">
                    <span className="text-4xl">👤</span>
                  </div>
                  <h3 className="text-2xl font-serif font-semibold text-white">
                    Agent One
                  </h3>
                  <p className="text-white/60 font-sans">
                    She trusts no one.
                  </p>
                </div>
              </div>
            </div>

            {/* Character 2 */}
            <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 backdrop-blur-sm">
              <div className="aspect-[3/4] bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
                <div className="text-center space-y-4 p-8">
                  <div className="w-32 h-32 mx-auto rounded-full bg-white/5 flex items-center justify-center">
                    <span className="text-4xl">👤</span>
                  </div>
                  <h3 className="text-2xl font-serif font-semibold text-white">
                    Agent Two
                  </h3>
                  <p className="text-white/60 font-sans">
                    He already knows too much.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Story Preview Rail */}
      <section className="w-full px-6 py-24">
        <div className="max-w-6xl mx-auto">
          <div className="text-center space-y-4 mb-16">
            <p className="text-xs tracking-[0.4em] text-primary/60 uppercase">
              Featured Stories
            </p>
            <h2 className="text-4xl md:text-5xl font-serif font-semibold text-white tracking-tight">
              Explore the collection
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { theme: "Sci-Fi", emoji: "🚀" },
              { theme: "Crime", emoji: "🔍" },
              { theme: "Thriller", emoji: "⚡" },
              { theme: "Mystery", emoji: "🔮" },
              { theme: "Drama", emoji: "🎭" },
              { theme: "Adventure", emoji: "🗺️" },
              { theme: "Conspiracy", emoji: "🕵️" },
              { theme: "Suspense", emoji: "🎬" },
            ].map((story) => (
              <div
                key={story.theme}
                className="group relative aspect-[2/3] rounded-xl border border-white/10 bg-gradient-to-br from-zinc-900 to-zinc-950 overflow-hidden cursor-pointer hover:border-primary/50 transition-all"
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
                  <span className="text-4xl mb-4">{story.emoji}</span>
                  <span className="text-white/80 font-serif font-semibold text-center">
                    {story.theme}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="w-full px-6 py-24 bg-zinc-950/50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center space-y-4 mb-16">
            <p className="text-xs tracking-[0.4em] text-primary/60 uppercase">
              How It Works
            </p>
            <h2 className="text-4xl md:text-5xl font-serif font-semibold text-white tracking-tight">
              Simple. Immersive. Ongoing.
            </h2>
          </div>

          <div className="space-y-12">
            {[
              {
                step: "01",
                title: "Read Episode 1",
                description: "Start reading immediately. No waiting, no synchronization.",
              },
              {
                step: "02",
                title: "Follow the Story",
                description: "Choose to follow an ongoing series for future episode releases.",
              },
              {
                step: "03",
                title: "Return for New Episodes",
                description: "Episodes release on a regular cadence. Continue the journey.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="flex gap-6 items-start p-8 rounded-2xl border border-white/5 bg-black/40 backdrop-blur-sm"
              >
                <span className="text-5xl font-serif font-semibold text-primary/30 flex-shrink-0">
                  {item.step}
                </span>
                <div className="space-y-2">
                  <h3 className="text-2xl font-serif font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="text-white/60 font-sans text-lg">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Upcoming Social Features */}
      <section className="w-full px-6 py-24">
        <div className="max-w-6xl mx-auto">
          <div className="text-center space-y-4 mb-16">
            <p className="text-xs tracking-[0.4em] text-primary/60 uppercase">
              Coming Soon
            </p>
            <h2 className="text-4xl md:text-5xl font-serif font-semibold text-white tracking-tight">
              Upcoming Social Features
            </h2>
            <p className="text-white/50 max-w-2xl mx-auto font-sans text-lg">
              The reading experience will evolve with community features designed
              to enhance story engagement.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Reader Notes",
                description: "Leave notes attached to specific moments in the story. AI ranks the highest quality notes for the community to discover.",
              },
              {
                title: "Predictions",
                description: "Make predictions about what happens next. See how your theories compare to the community distribution as episodes unfold.",
              },
              {
                title: "Episode Discussions",
                description: "Join spoiler-safe discussions after finishing each episode. Share theories, favorite moments, and reactions with fellow readers.",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="p-8 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-sm space-y-4"
              >
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 text-xs font-mono bg-primary/20 text-primary rounded">
                    COMING SOON
                  </span>
                </div>
                <h3 className="text-xl font-serif font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="text-white/60 font-sans leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="w-full px-6 py-24 bg-zinc-950/50">
        <div className="max-w-2xl mx-auto">
          <div className="text-center space-y-4 mb-16">
            <p className="text-xs tracking-[0.4em] text-primary/60 uppercase">
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
                a: "Each story is released in episodes. Episode 1 is available immediately. Future episodes release on a regular cadence. You can follow a story to be notified when new episodes arrive.",
              },
              {
                id: "following",
                q: "What does following mean?",
                a: "Following a story means you'll receive notifications when new episodes release. It's not a waitlist—it's tracking an ongoing series you want to continue reading.",
              },
              {
                id: "cost",
                q: "Is this free?",
                a: "Episode 1 is always free to read. Future episodes may require following the story or a subscription. Details vary by story.",
              },
              {
                id: "decisions",
                q: "How do decisions work?",
                a: "At key moments in the story, you'll make choices that influence how the narrative unfolds. Your decisions shape your unique reading experience.",
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
                    className={`h-4 w-4 shrink-0 text-white/40 transition-transform duration-200 ${openFaq === faq.id ? "rotate-180" : ""}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden transition-all duration-200 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                  <div className="px-4 py-4">
                    <p className="text-white/50 font-sans text-lg leading-relaxed">
                      {faq.a}
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative w-full pt-24 pb-16 px-6 bg-gradient-to-b from-transparent to-zinc-950/80">
        <CoverImage src={coverImageUrl} />
        <div className="max-w-md mx-auto text-center space-y-8 z-10 relative">
          <div className="space-y-4">
            <h2 className="text-4xl font-serif font-semibold text-white tracking-tight">
              Episode 1 is available now.
            </h2>
          </div>
          <div className="max-w-sm mx-auto">
            <ReadEpisodeButton className="py-6" />
            <p className="py-5 text-xs tracking-[0.4em] text-primary/70 font-sans uppercase text-center">
              The 25th Chapter
            </p>
          </div>
          <Button
            variant="ghost"
            className="text-white/50 font-sans leading-relaxed text-center text-base"
            onClick={() => {
              trackEvent("Return to Top Clicked");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Return to top
          </Button>
        </div>
      </section>
    </div>
  );
}
