import { LiveChat } from "@/components/LiveChat";
import { PushToggle } from "@/components/pwa/PushToggle";
import { useLiveChannel } from "@/hooks/use-live-channel";
import { usePlayback } from "@/hooks/use-playback";
import { cn } from "@/lib/utils";
import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_CHANNEL_ID } from "@shared/channel-id";
import { VideoDeliveryPlayer } from "./VideoDeliveryPlayer";
import { DecisionPhase } from "./DecisionPhase";

function formatViewerCount(viewerCount?: number) {
  if (typeof viewerCount !== "number") return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(viewerCount);
}

export function episodeProgressPercent(startAt?: number, endAt?: number, now = Date.now()): number {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt! <= startAt!) return 0;
  return Math.min(100, Math.max(0, ((now - startAt!) / (endAt! - startAt!)) * 100));
}

interface LiveBroadcastSectionProps {
  channelId?: string;
}

export function LiveBroadcastSection({ channelId = DEFAULT_CHANNEL_ID }: LiveBroadcastSectionProps) {
  const [chatOpen, setChatOpen] = useState(true);
  const liveState = useLiveChannel(channelId);
  const playbackQuery = usePlayback(channelId);
  const broadcast = playbackQuery.data?.broadcast;
  const delivery = playbackQuery.data?.delivery;
  const manifestUrl = playbackQuery.data?.playback?.playbackManifestUrl;
  const hasHealthyBroadcast = Boolean(delivery?.isRunning && delivery.isHealthy && manifestUrl);
  const deliveryIssue = delivery && (!delivery.isRunning || !delivery.isHealthy);
  const waitingForStreamer = broadcast?.mode === "waiting_for_streamer";
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const sessionStartAt = broadcast?.sessionScheduledStartAt;
  const sessionEndAt = broadcast?.sessionScheduledEndAt;
  const initialTimeRemaining = sessionStartAt && sessionEndAt
    ? Math.max(1, Math.round((sessionEndAt - sessionStartAt) / 1_000))
    : 1;
  const timeRemaining = sessionEndAt
    ? Math.max(0, Math.round((sessionEndAt - clock) / 1_000))
    : 0;

  return (
    <div className="live-broadcast-section relative z-10 mx-auto flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden">

      <section className="live-broadcast-layout flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden px-0 pt-1 md:px-3 pb-3 md:pt-3 lg:grid lg:grid-cols-1 lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-3 xl:grid-cols-[minmax(0,calc((100dvh-6rem)*1.7778))_minmax(320px,1fr)]">
        <div className="flex col-span-full shrink-0 justify-end md:justify-between">
          <div className="hidden md:flex items-baseline gap-2">
            <h1 className="font-sans font-semibold text-xl leading-tight text-white">25th Chapter</h1>
            <span className="hidden h-3 w-px bg-white/75 self-end md:inline" />
            <span className="font-mono uppercase tracking-[0.18em] text-white/75">{hasHealthyBroadcast ? "On air" : waitingForStreamer ? "Paused" : playbackQuery.isLoading ? "Checking signal" : broadcast?.mode || "Signal unavailable"}</span>
            <span className={cn("size-1.5 rounded-full", hasHealthyBroadcast ? "bg-primary shadow-[0_0_12px_rgba(251,191,36,0.9)]" : "bg-white/25")} aria-hidden="true" />
          </div>
          <PushToggle />
        </div>

        <div className="live-broadcast-player-zone relative flex min-h-0 min-w-0 w-full flex-1 basis-0 flex-col overflow-hidden lg:col-start-1 lg:row-start-2 lg:h-full lg:max-h-full lg:min-h-0 lg:w-full lg:basis-auto xl:col-start-1 xl:min-w-0 xl:w-full">
          <div className="absolute left-0 top-0 z-10 flex max-w-[calc(100%-1rem)] flex-col gap-1 p-1.5">
            {!liveState.wsConnected && !liveState.isLoading && (
              <div className="flex w-fit items-center justify-center gap-2 rounded-md bg-amber-300/[0.06] px-2 py-1.5 text-xs text-amber-100/65">
                <WifiOff className="size-2.5" />
                Connecting
              </div>
            )}
            <p className="sr-only" role="status">
              {hasHealthyBroadcast ? "On air" : waitingForStreamer ? "Paused" : playbackQuery.isLoading ? "Checking signal" : broadcast?.mode || "Signal unavailable"}
            </p>
            {waitingForStreamer && <div className="rounded-md bg-amber-300/[0.06] px-2 py-1.5 text-sm text-amber-100/75">
              Service reconnecting{broadcast?.streamer?.reason ? `: ${broadcast.streamer.reason}` : "."}
            </div>}
            {deliveryIssue && <div className="rounded-md px-2 text-sm"><span className="font-medium text-white/75">{delivery?.lastError || "We are reconnecting the signal."}</span></div>}
            {playbackQuery.isError && <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-sm text-white/75">We could not check the broadcast right now. Try refreshing in a moment.</div>}
          </div>
          <div className="relative h-full max-h-full min-h-0 w-full min-w-0 flex-none overflow-hidden rounded-none border-0 bg-[#050403] shadow-none md:rounded-[2rem] md:border md:border-white/20 md:shadow-[0_28px_100px_rgba(0,0,0,0.55)] lg:aspect-auto lg:h-full lg:max-h-full lg:w-full xl:aspect-auto xl:h-full xl:max-h-full xl:w-full xl:max-w-full">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_12%,rgba(243,174,48,0.18),transparent_38%),linear-gradient(135deg,#110c05,#030303_72%)]" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/45" />
            <VideoDeliveryPlayer className="live-broadcast-player absolute inset-0 h-full max-h-full min-h-0 w-full" manifestUrl={manifestUrl} captionTracks={playbackQuery.data?.playback?.captionTracks} isLive={hasHealthyBroadcast} channelId={channelId} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
              <DecisionPhase
                phase="reading"
                timeRemaining={timeRemaining}
                timeToDecision={0}
                initialTimeToDecision={1}
                initialTimeRemaining={initialTimeRemaining}
                turnsToNextChoice={-1}
                hasVoted={false}
                onVote={() => undefined}
                voteResults={{ A: 0, B: 0 }}
              />
            </div>
            <div className="hidden md:block pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent" />
          </div>
        </div>

        <aside className="flex min-h-0 min-w-0 w-full flex-1 basis-0 flex-col overflow-hidden lg:col-start-1 lg:row-start-2 lg:z-20 lg:h-full lg:max-h-full lg:min-h-0 lg:w-[340px] lg:basis-auto lg:flex-none lg:justify-self-end lg:self-stretch xl:col-start-2 xl:z-auto xl:h-full xl:max-h-full xl:min-h-0 xl:w-full xl:min-w-[320px] xl:basis-auto xl:justify-self-stretch">
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-none border-0 bg-black/35 shadow-none backdrop-blur-sm md:rounded-[2rem] xl:border xl:border-white/20 xl:shadow-[0_20px_80px_rgba(0,0,0,0.28)] md:bg-transparent lg:backdrop-blur-none xl:bg-black/35 xl:backdrop-blur-sm">
            <LiveChat numUsers={formatViewerCount(broadcast?.viewerCount)} history={liveState.chatHistory ?? []} mostRecentMessage={liveState.mostRecentMessage} username={liveState.username ?? "Guest"} onSend={liveState.submitChat ?? (() => undefined)} isOpen={chatOpen} keepOpen onToggle={() => setChatOpen((open) => !open)} />
          </div>
        </aside>
      </section>
    </div>
  );
}
