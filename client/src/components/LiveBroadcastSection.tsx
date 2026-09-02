import { LiveChat } from "@/components/LiveChat";
import { PushToggle } from "@/components/pwa/PushToggle";
import { useLiveChannel } from "@/hooks/use-live-channel";
import { usePlayback } from "@/hooks/use-playback";
import { cn } from "@/lib/utils";
import { ArrowLeft, WifiOff } from "lucide-react";
import { useState } from "react";
import { DEFAULT_CHANNEL_ID } from "@/App";
import { useLocation } from "wouter";
import { VideoDeliveryPlayer } from "./VideoDeliveryPlayer";

function formatViewerCount(viewerCount?: number) {
  if (typeof viewerCount !== "number") return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(viewerCount);
}

interface LiveBroadcastSectionProps {
  channelId?: string;
}

export function LiveBroadcastSection({ channelId = DEFAULT_CHANNEL_ID }: LiveBroadcastSectionProps) {
  const [chatOpen, setChatOpen] = useState(true);
  const liveState = useLiveChannel(channelId);
  const [, setLocation] = useLocation();
  const playbackQuery = usePlayback(channelId);
  const broadcast = playbackQuery.data?.broadcast;
  const delivery = playbackQuery.data?.delivery;
  const manifestUrl = playbackQuery.data?.playback?.playbackManifestUrl;
  const hasHealthyBroadcast = Boolean(delivery?.isRunning && delivery.isHealthy && manifestUrl);
  const deliveryIssue = delivery && (!delivery.isRunning || !delivery.isHealthy);
  const waitingForStreamer = broadcast?.mode === "waiting_for_streamer";

  return (
    <div className="live-broadcast-section relative z-10 mx-auto flex h-[100dvh] min-h-[100dvh] flex-col px-0 pb-0 pt-0 sm:h-auto sm:min-h-[100dvh] md:px-6 md:pb-7 md:pt-6">
      {!liveState.wsConnected && !liveState.isLoading && (
        <div className="mb-4 flex items-center justify-center gap-2 rounded-lg border bg-amber-300/[0.06] px-4 py-2 text-xs text-amber-100/65">
          <WifiOff className="size-3.5" />
          Connecting
        </div>
      )}

      <section className="live-broadcast-layout flex min-h-0 flex-1 flex-col gap-0 lg:grid md:gap-5 lg:grid-cols-[auto_1fr] lg:gap-6">
       {/* <div className="flex min-w-0 flex-col gap-4"> */}
         {/*
          <button type="button" onClick={() => setLocation("/")} className="group inline-flex items-center gap-2 text-xs text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary p-2" aria-label="Back to home">
            <ArrowLeft className="size-4 transition-transform" />
            <span className="hidden sm:inline">Exit</span>
          </button>
           */}
        {/* </div> */}

        <div className="live-broadcast-player-zone col-span-1 flex min-w-0 flex-col h-full gap-4">
          <div className="hidden md:flex items-baseline gap-2">
            <h1 className="font-sans font-semibold text-xl leading-tight text-white">25th Chapter</h1>
            <span className="hidden h-5 w-px bg-white/75 self-end md:inline" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/75">{hasHealthyBroadcast ? "On air" : waitingForStreamer ? "Production paused" : playbackQuery.isLoading ? "Checking signal" : broadcast?.mode || "Signal unavailable"}</span>
            <span className={cn("size-2 rounded-full", hasHealthyBroadcast ? "animate-pulse bg-primary shadow-[0_0_12px_rgba(251,191,36,0.9)]" : "bg-white/25")} aria-hidden="true" />
          </div>
          <p className="sr-only" role="status">
            {hasHealthyBroadcast ? "On air" : waitingForStreamer ? "Production paused" : playbackQuery.isLoading ? "Checking signal" : broadcast?.mode || "Signal unavailable"}
          </p>
          {waitingForStreamer && <div className="mb-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100/75">
            Service reconnecting{broadcast?.streamer?.reason ? `: ${broadcast.streamer.reason}` : "."}
          </div>}
          {deliveryIssue && <div className="mb-3 rounded-lg px-4 py-3 text-sm"><span className="font-medium text-white/75">{delivery?.lastError || "We are reconnecting the signal."}</span></div>}
          {playbackQuery.isError && <div className="mb-3 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-white/65">We could not check the broadcast right now. Try refreshing in a moment.</div>}
          <div className="group relative isolate h-full overflow-hidden rounded-none border-0 bg-[#050403] shadow-none md:rounded-[2rem] md:border md:border-white/20 md:shadow-[0_28px_100px_rgba(0,0,0,0.55)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_12%,rgba(243,174,48,0.18),transparent_38%),linear-gradient(135deg,#110c05,#030303_72%)]" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/45" />
            <VideoDeliveryPlayer className="live-broadcast-player h-full max-h-[calc(100dvh-12rem)] w-full" manifestUrl={manifestUrl} isLive={hasHealthyBroadcast} channelId={channelId} />
            <div className="hidden md:block pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent" />
          </div>
        </div>

        <aside className="flex flex-col flex-1 col-span-1 gap-4 lg:min-h-0">
          <PushToggle />
          <div className="live-broadcast-chat flex flex-1 min-h-0 overflow-hidden rounded-none border-0 bg-black/35 shadow-none backdrop-blur-sm md:min-h-[20rem] md:rounded-[2rem] md:border md:border-white/20 md:shadow-[0_20px_80px_rgba(0,0,0,0.28)]">
            <LiveChat numUsers={formatViewerCount(broadcast?.viewerCount)} history={liveState.chatHistory ?? []} mostRecentMessage={liveState.mostRecentMessage} username={liveState.username ?? "Guest"} onSend={liveState.submitChat ?? (() => undefined)} isOpen={chatOpen} keepOpen onToggle={() => setChatOpen((open) => !open)} />
          </div>
        </aside>
      </section>
    </div>
  );
}
