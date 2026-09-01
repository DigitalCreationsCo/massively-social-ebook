import { LiveChat } from "@/components/LiveChat";
import { LiveStreamPlayer } from "@/components/LiveStreamPlayer";
import { PushToggle } from "@/components/pwa/PushToggle";
import { useLiveChannel } from "@/hooks/use-live-channel";
import { usePlayback } from "@/hooks/use-playback";
import { cn } from "@/lib/utils";
import { ArrowLeft, WifiOff } from "lucide-react";
import { useState } from "react";
import { DEFAULT_CHANNEL_ID } from "@/App";
import { useLocation } from "wouter";

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
    <div className="relative z-10 mx-auto flex min-h-[100dvh] flex-col px-4 pb-5 pt-4 sm:px-6 sm:pb-7 sm:pt-6">
      <header className="mb-5 flex items-center justify-between gap-4">
        <div className="md:hidden">
          <button type="button" onClick={() => setLocation("/")} className="hidden group inline-flex items-center gap-2 text-xs text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary p-2" aria-label="Back to home">
            <ArrowLeft className="size-4 transition-transform" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-2">
          <span className={cn("size-2 rounded-full", hasHealthyBroadcast ? "animate-pulse bg-primary shadow-[0_0_12px_rgba(251,191,36,0.9)]" : "bg-white/25")} aria-hidden="true" />
          <span className="hidden h-4 w-px bg-white/75 sm:block" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/75">{hasHealthyBroadcast ? "On air" : waitingForStreamer ? "Production paused" : playbackQuery.isLoading ? "Checking signal" : broadcast?.mode || "Signal unavailable"}</span>
        </div>
        <div className="">
          <PushToggle />
        </div>
      </header>

      {!liveState.wsConnected && !liveState.isLoading && (
        <div className="mb-4 flex items-center justify-center gap-2 rounded-lg border bg-amber-300/[0.06] px-4 py-2 text-xs text-amber-100/65">
          <WifiOff className="size-3.5" />
          Connecting
        </div>
      )}

      <section className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-6">
        <div className="flex min-w-0 flex-col 2xl:pl-[23rem]">
          <LiveStreamPlayer manifestUrl={manifestUrl} isLive={hasHealthyBroadcast} channelId={channelId} />

          {waitingForStreamer && <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100/75">
            Production is paused while the stream service reconnects{broadcast?.streamer?.reason ? `: ${broadcast.streamer.reason}` : "."}
          </div>}
          {deliveryIssue && <div className="mt-3 rounded-lg px-4 py-3 text-sm"><span className="font-medium text-white/75">{delivery?.lastError || "We are reconnecting the signal."}</span></div>}
          {playbackQuery.isError && <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-white/65">We could not check the broadcast right now. Try refreshing in a moment.</div>}
        </div>

        <aside className="flex min-h-[20rem] rounded-[2rem] overflow-hidden border border-white/20 bg-black/35 shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur-sm lg:min-h-0">
          <LiveChat numUsers={formatViewerCount(broadcast?.viewerCount)} history={liveState.chatHistory ?? []} mostRecentMessage={liveState.mostRecentMessage} username={liveState.username ?? "Guest"} onSend={liveState.submitChat ?? (() => undefined)} isOpen={chatOpen} keepOpen onToggle={() => setChatOpen((open) => !open)} />
        </aside>
      </section>
    </div>
  );
}
