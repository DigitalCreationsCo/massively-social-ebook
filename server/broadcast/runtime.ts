import { QueueBroadcastClient } from "@portalshq/capability-queue-broadcast";
import {
  LiveDelivery,
  type CaptionTrack,
  type HlsPlaybackSession,
  type LiveDeliveryStatus,
} from "@portalshq/capability-video-delivery";
import { RealtimeEngine } from "@portalshq/runtime-core";
import type { WsMessage } from "@shared/schema";

import { ChatGateway } from "../chat/gateway";
import { ExternalChatConnectors } from "../chat/providers";
import { logger } from "../logger";
import { BroadcastCoordinator, type BroadcastCoordinatorStatus } from "./coordinator";
import {
  createTimeoutFetch,
  loadBroadcastConfig,
  type BroadcastChannelConfig,
} from "./config";

interface ChannelRuntime {
  config: BroadcastChannelConfig;
  client: QueueBroadcastClient;
  coordinator: BroadcastCoordinator;
  playback: HlsPlaybackSession | null;
  delivery: LiveDelivery | null;
  playbackPromise?: Promise<void>;
  playbackError?: string;
  lastPlaybackAttemptAt?: number;
  playbackFailureCount?: number;
}

export interface ChannelPlaybackStatus {
  playback: HlsPlaybackSession | null;
  delivery: LiveDeliveryStatus | {
    isRunning: false;
    isHealthy: false;
    lastError?: string;
  };
  broadcast: BroadcastCoordinatorStatus & { viewerCount: number };
}

export class BroadcastRuntime {
  readonly configs = loadBroadcastConfig();
  readonly chatGateway: ChatGateway;
  readonly externalChat: ExternalChatConnectors;
  private readonly channels = new Map<string, ChannelRuntime>();
  private readonly engine: RealtimeEngine;
  private readonly compatibilityActivators = new Set<string>();

  constructor(broadcast: (channelId: string, message: WsMessage) => void) {
    const requestFetch = createTimeoutFetch();
    const uploadFetch = createTimeoutFetch(Number(process.env.BROADCAST_UPLOAD_TIMEOUT_MS || 120_000));
    for (const config of this.configs.values()) {
      const client = new QueueBroadcastClient({
        endpoint: config.endpoint,
        token: config.queueToken,
        fetch: requestFetch,
        uploadFetch,
      });
      this.channels.set(config.channelId, {
        config,
        client,
        coordinator: new BroadcastCoordinator(config.channelId, client),
        playback: null,
        delivery: null,
      });
    }
    this.chatGateway = new ChatGateway(this.configs, broadcast);
    this.externalChat = new ExternalChatConnectors(this.configs, this.chatGateway);
    this.engine = new RealtimeEngine({
      tickIntervalMs: 5_000,
      onActivate: async (channelId) => this.requireChannel(channelId).coordinator.activate(),
      onTick: async (channelId) => this.requireChannel(channelId).coordinator.tick(),
      onDeactivate: async (channelId) => {
        logger.info(`Broadcast runtime stopped ticking ${channelId}`, "broadcast");
      },
      logger,
    });
  }

  async initialize(): Promise<void> {
    await this.chatGateway.initialize();
    for (const channel of this.channels.values()) {
      await channel.coordinator.initialize();
      // Playback fetch must never block startup or viewer requests.
      // Prime cache in background with backoff; a missing streamer should
      // not make initialize() or /playback hang for 15s.
      void this.ensurePlayback(channel).catch((cause) => {
        logger.warn(
          `Playback is not ready for ${channel.config.channelId}`,
          "broadcast",
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      });
      await this.ensureEngineActive(channel.config.channelId);
    }
    this.externalChat.start();
  }

  hasChannel(channelId: string): boolean {
    return this.channels.has(channelId);
  }

  async getPlaybackStatus(channelId: string): Promise<ChannelPlaybackStatus> {
    const channel = this.requireChannel(channelId);
    // Do not block the HTTP response on a 10-15s Streamer fetch.
    // Return cached playback immediately; refresh in background with backoff.
    if (!channel.playback || !channel.delivery) {
      void this.ensurePlayback(channel).catch(() => undefined);
    } else if (channel.delivery && !channel.delivery.getStatus().isRunning) {
      // Re-start hls delivery without blocking the response.
      void channel.delivery.start().catch((cause) => {
        channel.playbackError = cause instanceof Error ? cause.message : String(cause);
      });
    }
    const broadcast = this.getCoordinatorStatus(channelId);
    return {
      // Captions are sidecar WebVTT cues, deliberately kept out of the HLS
      // media. The coordinator changes this only when the Streamer's own job
      // state says the corresponding slot is actually playing.
      playback: withCurrentCaption(channel.playback, broadcast.caption),
      delivery: channel.delivery?.getStatus() ?? {
        isRunning: false,
        isHealthy: false,
        ...(channel.playbackError ? { lastError: channel.playbackError } : {}),
      },
      broadcast,
    };
  }

  getCoordinatorStatus(channelId: string): BroadcastCoordinatorStatus & { viewerCount: number } {
    return {
      ...this.requireChannel(channelId).coordinator.getStatus(),
      viewerCount: this.publicViewerCount(channelId),
    };
  }

  async restart(channelId: string): Promise<void> {
    const channel = this.requireChannel(channelId);
    await channel.coordinator.restart("operator");
    await this.ensureEngineActive(channelId);
  }

  async stop(channelId: string): Promise<void> {
    const channel = this.requireChannel(channelId);
    await channel.coordinator.stop();
    const enhanced = this.engine as RealtimeEngine & { stop?: (id: string) => Promise<void> };
    await enhanced.stop?.(channelId);
  }

  async addViewer(channelId: string, connectionId: string): Promise<void> {
    if (!this.channels.has(channelId)) return;
    await this.engine.addViewer(channelId, connectionId);
  }

  removeViewer(channelId: string, connectionId: string): void {
    if (this.channels.has(channelId)) this.engine.removeViewer(channelId, connectionId);
  }

  async shutdown(): Promise<void> {
    await this.externalChat.stop();
    this.chatGateway.shutdown();
    await Promise.all([...this.channels.values()].map(async (channel) => {
      await channel.coordinator.shutdown();
      await channel.delivery?.stop();
    }));
    const enhanced = this.engine as RealtimeEngine & { shutdown?: () => Promise<void> };
    if (enhanced.shutdown) await enhanced.shutdown();
    else this.engine.stopAll();
  }

  private async ensurePlayback(channel: ChannelRuntime): Promise<void> {
    if (channel.playback && channel.delivery) return;
    if (channel.playbackPromise) return channel.playbackPromise;
    // Exponential backoff 2s → 5s → 10s (then stays 10s) — avoids hammering
    // the Streamer on every viewer poll (≈5-15s × N viewers) while keeping
    // reconnect latency bounded. Mirrors coordinator STREAMER_RETRY_DELAYS_MS
    // but capped at 10s per request (2/5/10).
    const now = Date.now();
    if (channel.playbackError) {
      const count = channel.playbackFailureCount ?? 1;
      const delays = [2_000, 5_000, 10_000];
      const delayMs = delays[Math.min(Math.max(0, count - 1), delays.length - 1)]!;
      if (now - (channel.lastPlaybackAttemptAt ?? 0) < delayMs) return;
    }
    channel.lastPlaybackAttemptAt = now;
    channel.playbackPromise = (async () => {
      try {
        const playback = await channel.client.getPlayback();
        if (process.env.NODE_ENV === "production" && new URL(playback.playbackManifestUrl).protocol !== "https:") {
          throw new Error("Playback manifest must use HTTPS in production");
        }
        channel.playback = playback;
        channel.delivery = new LiveDelivery({
          ...playback,
          fetch: createTimeoutFetch(10_000),
          healthCheckIntervalMs: 30_000,
        });
        await channel.delivery.start();
        channel.playbackError = undefined;
        channel.playbackFailureCount = 0;
      } catch (cause) {
        channel.playbackError = cause instanceof Error ? cause.message : String(cause);
        channel.playbackFailureCount = (channel.playbackFailureCount ?? 0) + 1;
        throw cause;
      } finally {
        channel.playbackPromise = undefined;
      }
    })();
    return channel.playbackPromise;
  }

  private requireChannel(channelId: string): ChannelRuntime {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Channel ${channelId} has no broadcast configuration`);
    return channel;
  }

  private async ensureEngineActive(channelId: string): Promise<void> {
    const enhanced = this.engine as RealtimeEngine & { ensureActive?: (id: string) => Promise<void> };
    if (enhanced.ensureActive) {
      await enhanced.ensureActive(channelId);
      return;
    }
    const connectionId = `broadcast-runtime:${channelId}`;
    this.compatibilityActivators.add(channelId);
    await this.engine.addViewer(channelId, connectionId);
  }

  private publicViewerCount(channelId: string): number {
    return Math.max(0, this.engine.viewerCount(channelId) - (this.compatibilityActivators.has(channelId) ? 1 : 0));
  }
}

const CURRENT_CAPTION_TRACK_ID = "live-current-caption";
const CURRENT_CAPTION_CUE_END_SECONDS = 365 * 24 * 60 * 60;

function withCurrentCaption(
  playback: HlsPlaybackSession | null,
  caption: string | undefined,
): HlsPlaybackSession | null {
  if (!playback) return null;
  const text = caption?.trim();
  const captionTracks: CaptionTrack[] = text ? [{
    id: CURRENT_CAPTION_TRACK_ID,
    label: "English",
    language: "en",
    kind: "captions",
    default: true,
    // This track is remounted when the Streamer advances to a different slot.
    // A long cue makes it active at the live media position without assuming
    // that a rolling HLS manifest starts its timeline at zero.
    cues: [{ startTimeSeconds: 0, endTimeSeconds: CURRENT_CAPTION_CUE_END_SECONDS, text }],
  }] : [];
  return { ...playback, captionTracks };
}
