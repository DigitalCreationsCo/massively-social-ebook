import { useQuery } from "@tanstack/react-query";

export interface PlaybackDetails {
  sessionId: number | string;
  playbackManifestUrl: string;
}

export interface PlaybackDelivery {
  isRunning: boolean;
  isHealthy: boolean;
  lastCheckedAt?: string | null;
  lastError?: string | null;
}

export interface PlaybackBroadcast {
  desiredState: string;
  mode: string;
  sessionStatus: string;
  viewerCount: number;
  streamer?: {
    state: "unknown" | "available" | "unavailable";
    lastCheckedAt?: number;
    lastSuccessfulAt?: number;
    retryAt?: number;
    reason?: string;
  };
}

export interface ChannelPlaybackResponse {
  playback: PlaybackDetails | null;
  delivery: PlaybackDelivery;
  broadcast: PlaybackBroadcast;
}

async function fetchPlayback(channelId: string): Promise<ChannelPlaybackResponse | null> {
  const response = await fetch(`/api/channels/${encodeURIComponent(channelId)}/playback`, {
    credentials: "include",
  });

  // A channel without broadcast provisioning is an expected /watch state.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Unable to check the live broadcast right now.");
  return response.json() as Promise<ChannelPlaybackResponse>;
}

/** Poll broadcast status separately so a broken player never hides /watch. */
export function usePlayback(channelId: string) {
  return useQuery({
    queryKey: ["channel-playback", channelId],
    queryFn: () => fetchPlayback(channelId),
    enabled: Boolean(channelId),
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    retry: 1,
  });
}
