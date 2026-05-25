import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useLiveState } from "@/hooks/use-live-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Calendar,
  Bell,
  Loader2,
  BookOpen,
  Mail,
  Clock,
  ChevronDown,
} from "lucide-react";
import { formatInTZ, isTodayInTZ, isTomorrowInTZ } from "@shared/date";
import { api } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { validateSchemaDates } from "@/lib/validateSchema";
import { trackEvent } from "@/lib/analytics";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import Timer from "@/components/TImer";
import { useSessionReplay } from "@/hooks/use-session-replay";
import { Replay } from "@/components/Replay";
import { useQuery } from "@tanstack/react-query";
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

function ReserveSeatButton({
  channelId,
  sessionId,
  className,
}: {
  channelId: string;
  sessionId?: string;
  className?: string | string[];
}) {
  const { toast } = useToast();
  const [reminding, setReminding] = useState(false);
  const [email, setEmail] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [subscribeToUpdates, setSubscribeToUpdates] = useState(true);
  const [subscribeToStories, setSubscribeToStories] = useState(true);
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    if (!isDialogOpen) {
      const t = setTimeout(() => setStep(1), 300);
      return () => clearTimeout(t);
    }
  }, [isDialogOpen]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) {
      if (!email) return;
      setStep(2);
    } else {
      handleReminder();
    }
  };

  const handleReminder = async () => {
    if (!email) return;
    setReminding(true);
    trackEvent("Set Reminder Clicked", { channel: channelId, sessionId });
    try {
      const res = await fetch(api.sessions.reminder.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          email,
          subscribeToUpdates,
          subscribeToStories,
        }),
      });

      if (!res.ok && res.status !== 404) throw new Error("Failed to subscribe");

      const message = await res.json();
      const description =
        message.message?.split(". ")[1] ??
        message.message?.split(". ")[0] ??
        `You'll receive an email with the next session schedule.`;
      const title = message.message?.split(". ")[1]
        ? message.message?.split(". ")[0]
        : `You're on the list.`;

      trackEvent("Set Reminder Success", {
        channel: channelId,
        sessionId,
        email,
      });
      toast({
        title,
        description,
      });
      setIsDialogOpen(false);
      setEmail("");
    } catch (err) {
      trackEvent("Set Reminder Failed", {
        channel: channelId,
        sessionId,
        error: String(err),
      });
      toast({
        title: "Error",
        description: "Could not subscribe. Please try again.",
        variant: "destructive",
      });
    } finally {
      setReminding(false);
    }
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button
          className={cn(
            "w-full bg-primary hover:bg-primary/90 text-primary-foreground font-serif font-semibold tracking-tight text-3xl py-10 shadow-[0_0_30px_rgba(var(--primary),0.2)] transition-all hover:scale-[1.01]",
            className,
          )}
        >
          Join Tonight's Story
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-zinc-950 border-white/10 text-white shadow-2xl">
        <form
          onSubmit={handleFormSubmit}
          className="py-2 overflow-visible px-1 -mx-1"
        >
          <AnimatePresence mode="wait" initial={false}>
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <DialogHeader>
                  <DialogTitle className="text-3xl font-serif font-semibold mb-4">
                    Remind Me
                  </DialogTitle>
                  <DialogDescription className="text-white/60 font-sans">
                    Enter your email address to receive an invitation to
                    tonight's story.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 mt-4">
                  <Label
                    htmlFor="email"
                    className="text-xs tracking-widest text-primary/60 ml-1 hidden"
                  >
                    Email Address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="youraddress@email.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-white/5 border-white/10 focus:border-primary/50 h-14"
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    className="w-full h-16 bg-primary text-primary-foreground font-serif font-semibold text-xl shadow-lg"
                  >
                    Continue
                  </Button>
                </DialogFooter>
              </motion.div>
            )}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="space-y-6 mt-4"
              >
                <DialogHeader>
                  <DialogTitle className="text-3xl font-serif font-semibold mb-4">
                    Subscribe To New Stories
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex items-center justify-between space-x-4 rounded-xl border border-white/5 bg-black/20 p-4">
                    <div className="flex flex-col space-y-1">
                      <Label className="font-medium text-white">
                        Subscribe to updates
                      </Label>
                      <p className="text-xs text-white/50">
                        Monthly email about new features
                      </p>
                    </div>
                    <Switch
                      checked={subscribeToUpdates}
                      onCheckedChange={setSubscribeToUpdates}
                    />
                  </div>

                  <div className="flex items-center justify-between space-x-4 rounded-xl border border-white/5 bg-black/20 p-4">
                    <div className="flex flex-col space-y-1">
                      <Label className="font-medium text-white">
                        Subscribe to new stories
                      </Label>
                      <p className="text-xs text-white/50">
                        Be notified about new stories
                      </p>
                    </div>
                    <Switch
                      checked={subscribeToStories}
                      onCheckedChange={setSubscribeToStories}
                    />
                  </div>

                  <div className="flex items-center justify-between space-x-4 rounded-xl border border-white/5 bg-black/20 p-4">
                    <div className="flex flex-col space-y-1">
                      <Label className="text-sm font-medium text-white">
                        Follow us on X
                      </Label>
                    </div>
                    <a
                      href="https://x.com/25thchptr"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        className="h-8 border-white/10 bg-transparent text-white hover:bg-white/10"
                      >
                        Follow
                      </Button>
                    </a>
                  </div>
                </div>

                <DialogFooter className="flex-col sm:flex-col gap-3">
                  <Button
                    type="submit"
                    disabled={reminding}
                    className="w-full h-16 bg-primary text-primary-foreground font-serif font-semibold text-xl shadow-lg"
                  >
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep(1)}
                    className="w-full text-white/50 hover:text-white h-12"
                  >
                    Back
                  </Button>
                </DialogFooter>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </DialogContent>
    </Dialog>
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
  } = useLiveState(channelId);
  const [_, setLocation] = useLocation();
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  // Fetch channel data for coverImage
  const { data: channel } = useQuery({
    queryKey: [api.channels.list.path, channelId],
    queryFn: async () => {
      const res = await fetch(api.channels.list.path);
      if (!res.ok) throw new Error("Failed to fetch channels");
      const channels = (await res.json()) as Array<{
        channelId: string;
        coverImage?: string | null;
      }>;
      return channels.find((c) => c.channelId === channelId) ?? null;
    },
    staleTime: 60_000,
  });
  const coverImageUrl = channel?.coverImage ?? null;

  const {
    session: previousSession,
    blocks: previousBlocks,
    isLoading: isReplayLoading,
  } = useSessionReplay({ channelId, notableOnly: true });

  const previousSessionExists =
    previousSession && previousBlocks && previousBlocks.length > 0;

  const replayRef = useRef<HTMLDivElement>(null);

  const [timeLeft, setTimeLeft] = useState("");
  const [timerHelpText, setTimerHelpText] = useState("Starts In");

  useEffect(() => {
    if (!nextSession?.scheduledStart) return;

    const target = new Date(nextSession.scheduledStart).getTime();

    const updateTimer = () => {
      const now = new Date().getTime();
      const diff = target - now;

      if (diff <= 0) {
        setTimerHelpText("");
        setTimeLeft("Starting...");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft(
        `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`,
      );
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [nextSession?.scheduledStart]);

  // Redirect when the session is in its live window (including status still 'scheduled').
  useEffect(() => {
    if (wsConnected && isSessionLive) {
      setLocation("/");
    }
  }, [wsConnected, isSessionLive, setLocation]);

  // If session is active, the user should be redirected anyway, but we show a link
  const isScheduled = sessionStatus === "scheduled" && nextSession;

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
      <section className="relative min-h-screen h-screen max-w-3xl w-full flex items-start justify-center py-2 pb-12 px-6 mb-12 overflow-hidden">
        <div className="flex flex-col flex-1 max-w-xl min-h-full h-full w-full relative bg-black bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900 via-black to-black">
          <p className="py-5 text-xs tracking-[0.4em] text-primary/70 font-sans uppercase text-center">
            25th Chapter Presents
          </p>
          <Card className="relative z-10 h-full bg-white/5 backdrop-blur-xl shadow-2xl overflow-hidden animate-fade-in-up">
            <CoverImage
              src={coverImageUrl}
              parallaxSpeed={0.05}
              parallaxDirection="down"
            />
            <div className="h-1 bg-gradient-to-r from-primary/50 via-primary to-primary/50 text-glow-primary" />
            <CardHeader className="isolate z-10 text-center pb-0 pt-10">
              <CardDescription className="text-white/80 font-sans text-lg">
                {isScheduled && (
                  <span>
                    {isTodayInTZ(
                      new Date(nextSession.scheduledStart),
                      userTimeZone,
                    )
                      ? "Today"
                      : isTomorrowInTZ(
                            new Date(nextSession.scheduledStart),
                            userTimeZone,
                          )
                        ? "Tomorrow"
                        : formatInTZ(
                            new Date(nextSession.scheduledStart),
                            userTimeZone,
                            "EEEE, MMMM do",
                          )}{" "}
                    at{" "}
                    {formatInTZ(
                      new Date(nextSession.scheduledStart),
                      userTimeZone,
                      "h:mm a",
                    )}{" "}
                    {getTimezoneDisplay(userTimeZone).split(" ")[0]}
                  </span>
                )}
              </CardDescription>
            </CardHeader>

            <CardContent className="isolate z-10 space-y-10 flex flex-col flex-1 pt-8 pb-12 px-8">
              <div className="flex flex-col space-y-10">
                {nextSession && (
                  <>
                    <div className="p-8 bg-black/40 rounded-xl border border-white/5 space-y-4 shadow-inner">
                      <h2 className="text-3xl font-serif font-semibold text-white text-center mb-4 tracking-tight leading-tight">
                        {nextSession.title}
                      </h2>
                      <p className="text-white/50 font-sans leading-relaxed text-center group-hover:text-white/70 transition-colors">
                        {nextSession.description}
                      </p>
                    </div>
                    <Timer timeLeft={timeLeft} timerHelpText={timerHelpText} />
                  </>
                )}

                <div className="h-full flex flex-col flex-1 space-y-4">
                  <ReserveSeatButton
                    channelId={channelId}
                    sessionId={nextSession?.id}
                  />

                  <div className="text-center h-full pt-2">
                    {previousSessionExists ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          trackEvent("Watch Previous Session Clicked", {
                            channel: channelId,
                          });
                          document
                            .getElementById("previous-session")
                            ?.scrollIntoView({ behavior: "smooth" });
                        }}
                        className="text-base text-white/50 hover:text-white transition-colors"
                      >
                        Watch the previous session →
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        className="font-sans text-sm uppercase tracking-[0.3em] py-6 px-8 transition-all"
                        onClick={() => {
                          trackEvent("Preview Chapter Clicked", {
                            channel: channelId,
                          });
                          document
                            .getElementById("preview")
                            ?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        Learn More
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <div className="pt-8 border-t border-white/5 text-center">
                <p className="text-[10px] text-white/20 uppercase tracking-[0.5em]">
                  The 25th Chapter
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Previously Aired Section */}
      {previousSessionExists && (
        <section
          id="previous-session"
          className="w-full min-h-screen h-screen px-6 py-12 mb-12 bg-zinc-950/30"
        >
          <div className="max-w-md flex flex-col min-h-full mx-auto space-y-10">
            <div className="px-6 text-center space-y-3">
              <p className="text-xs tracking-[0.4em] text-primary/60 uppercase">
                Previously Aired
              </p>

              <h2 className="text-4xl font-serif font-semibold text-white tracking-tight">
                Catch up before tonight’s session
              </h2>

              <p className="text-white/50 max-w-2xl mx-auto font-sans">
                Replay the previous chapter and experience how the story
                unfolded.
              </p>
            </div>

            <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition-all duration-500 h-full">
              <div className="flex flex-col flex-1 min-h-full h-full border">
                <div
                  ref={replayRef}
                  className="relative min-h-[300px] h-[300px] bg-black overflow-hidden"
                >
                  <Replay
                    session={previousSession}
                    blocks={previousBlocks || []}
                    onPlay={() => {
                      trackEvent("Replay Started", { channel: channelId });
                    }}
                  />
                  {/* <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" /> */}
                </div>
                {/* Content */}
                {/* Episode One */}
                {/* Desert Rose: 12 Days Since the Last Rain */}
                {/* Two friends travel across a foreign country, uncovering secrets and dangers. */}
                <div className="p-6 lg:p-8 flex flex-col justify-center">
                  <div className="space-y-4">
                    <p className="text-xs tracking-[0.3em] uppercase text-primary/50">
                      {`Episode ${previousSession?.episodeNumber}`}
                    </p>
                    <h3 className="text-3xl font-serif font-semibold text-white leading-tight">
                      {previousSession?.title}
                    </h3>
                    <p className="text-white/60 leading-relaxed">
                      {previousSession?.description}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-row flex-wrap justify-center gap-4">
              <Button
                variant="secondary"
                onClick={() => {
                  trackEvent("Learn More Clicked", { channel: channelId });
                  document
                    .getElementById("preview")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
                className="uppercase text-sm hover:text-white tracking-[0.3em] py-6 px-8 transition-all"
              >
                Learn More
              </Button>
            </div>
          </div>
        </section>
      )}
      {/* Preview Section */}
      <section id="preview" className="w-full px-6 mx-auto py-12">
        <div className="flex flex-col gap-16 justify-center items-center">
          {/* Mockup Display */}
          <div className="flex flex-col max-w-md w-full space-y-8 lg:col-start-2">
            <div className="space-y-4 px-6 mx-auto">
              <h2 className="text-4xl font-serif font-semibold text-center text-white tracking-tight whitespace-nowrap">
                The 25th Chapter
              </h2>
              <p className="text-white/50 font-sans text-lg max-w-2xl leading-relaxed">
                Join fellow readers in a live session to unfold the narrative.
              </p>
            </div>
            <div className="relative group flex-grow min-h-0 flex justify-center">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20 rounded-2xl blur-2xl opacity-60 transition duration-1000 w-full h-full"></div>
              <img
                src="/preview/1.png"
                alt="The 25th Chapter: 25 minutes. One Story."
                className="relative h-full w-auto object-contain rounded-xl border border-white/5 shadow-3xl bg-zinc-900"
              />
            </div>
          </div>

          <div className="min-h-[80vh]">
            {/* FAQ Aside */}
            <aside
              id="faq"
              className="border pt-12 pb-16 my-12 w-full max-w-md space-y-12 p-10 rounded-2xl backdrop-blur-sm lg:col-start-3"
            >
              <div className=" text-center space-y-4">
                <h2 className="text-3xl font-serif font-semibold text-white">
                  FAQ
                </h2>
                <p className="text-sm text-primary/60 font-sans uppercase tracking-widest">
                  Everything you need to know
                </p>
              </div>

              <div className="space-y-3">
                {[
                  {
                    id: "session",
                    q: "What is a 25-minute session?",
                    a: "Every day is a new chapter. Gather for 25 minutes to read and influence the story in real-time.",
                  },
                  {
                    id: "missed",
                    q: "Can I read missed chapters?",
                    a: "All chapters are saved and will be available soon.",
                  },
                  {
                    id: "decisions",
                    q: "How do decisions work?",
                    a: "Readers decide on key plot points with a community vote. The path with the most votes becomes part of the story.",
                  },
                  {
                    id: "app",
                    q: "How can I download the app?",
                    a: null,
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
                      <h3 className="text-2xl font-serif font-semibold text-white">
                        {faq.q}
                      </h3>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-white/40 transition-transform duration-200 ${openFaq === faq.id ? "rotate-180" : ""}`}
                      />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="overflow-hidden transition-all duration-200 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                      <div className="px-4 py-4">
                        {faq.a ? (
                          <p className="text-white/50 font-sans text-lg leading-relaxed">
                            {faq.a}
                          </p>
                        ) : (
                          <div className="space-y-4">
                            <p className="text-white/50 font-sans text-lg leading-relaxed">
                              You can add The 25th Chapter to your home screen
                              for a native app-like experience. Click below for
                              a simple guide.
                            </p>
                            <Link to="/install">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-lg border-white/20 bg-white/5 hover:bg-white/10"
                              >
                                Installation Instructions
                              </Button>
                            </Link>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="relative w-full pt-24 pb-16 px-6 bg-gradient-to-b from-transparent to-zinc-950/80">
        <CoverImage
          src={
            previousBlocks?.[randomIndexBlockWithImage]?.imageUrl ??
            coverImageUrl
          }
        />
        <div className="max-w-md mx-auto text-center space-y-8 z-10">
          <div className="space-y-4">
            <h2 className="text-4xl font-serif font-semibold text-white tracking-tight">
              The next story starts soon.
            </h2>
          </div>
          <div className="max-w-sm mx-auto">
            <ReserveSeatButton
              className="py-6"
              channelId={channelId}
              sessionId={nextSession?.id}
            />
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
