import { normalizeBroadcastEndpoint } from "@portalshq/capability-queue-broadcast";
import { getChannelRegistry, type RegistryChannelConfig } from "../channel-registry";

export type YoutubeBroadcastConfig = NonNullable<RegistryChannelConfig["youtube"]>;
export type TwitchBroadcastConfig = NonNullable<RegistryChannelConfig["twitch"]>;

export interface BroadcastChannelConfig {
  channelId: string;
  /** Normalized authenticated FastAPI control-plane URL; never the HLS manifest URL. */
  endpoint: string;
  queueToken: string;
  youtube?: YoutubeBroadcastConfig;
  twitch?: TwitchBroadcastConfig;
}

export function loadBroadcastConfig(): Map<string, BroadcastChannelConfig> {
  const registry = getChannelRegistry().channels;
  const configs = new Map<string, BroadcastChannelConfig>();
  const endpoints = new Set<string>();
  for (const [channelId, entry] of Object.entries(registry)) {
    const configuredEndpoint = entry.controlEndpoint ?? entry.endpoint;
    if (!configuredEndpoint) throw new Error(`Broadcast control endpoint is required for ${channelId}`);
    const endpoint = normalizeBroadcastEndpoint(configuredEndpoint);
    if (entry.controlEndpoint && entry.endpoint) {
      const legacyEndpoint = normalizeBroadcastEndpoint(entry.endpoint);
      if (legacyEndpoint !== endpoint) {
        throw new Error(`controlEndpoint and legacy endpoint disagree for ${channelId}`);
      }
    }
    assertControlEndpoint(channelId, endpoint);
    if (process.env.NODE_ENV === "production" && new URL(endpoint).protocol !== "https:") {
      throw new Error(`Broadcast endpoint for ${channelId} must use HTTPS in production`);
    }
    if (endpoints.has(endpoint)) {
      throw new Error(`Broadcast endpoint ${endpoint} is configured for more than one channel`);
    }
    endpoints.add(endpoint);
    const queueToken = requireSecret(entry.queueTokenEnv, `queue token for ${channelId}`);
    validateProviderSecrets(channelId, entry.youtube);
    validateProviderSecrets(channelId, entry.twitch);
    configs.set(channelId, {
      channelId,
      endpoint,
      queueToken,
      ...(entry.youtube ? { youtube: entry.youtube } : {}),
      ...(entry.twitch ? { twitch: entry.twitch } : {}),
    });
  }
  return configs;
}

/** Reject the Streamer's public MediaMTX HLS listener before a cryptic 500. */
function assertControlEndpoint(channelId: string, endpoint: string): void {
  const url = new URL(endpoint);
  if (url.port === "8888" || url.pathname.endsWith(".m3u8")) {
    throw new Error(
      `Broadcast controlEndpoint for ${channelId} must target the Streamer FastAPI control API (usually :8000), not its public HLS listener (:8888). `
      + "The streamer returns the HLS manifest separately from GET /v1/stream.",
    );
  }
}

export function requireSecret(name: string, purpose: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for ${purpose}`);
  return value;
}

function validateProviderSecrets(
  channelId: string,
  config: YoutubeBroadcastConfig | TwitchBroadcastConfig | undefined,
): void {
  if (!config) return;
  requireSecret(config.clientIdEnv, `provider client id for ${channelId}`);
  requireSecret(config.clientSecretEnv, `provider client secret for ${channelId}`);
  requireSecret(config.refreshTokenEnv, `provider refresh token for ${channelId}`);
}

export function createTimeoutFetch(
  timeoutMs = Number(process.env.BROADCAST_FETCH_TIMEOUT_MS || 15_000),
): typeof fetch {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("broadcast fetch timeout must be a positive number of milliseconds");
  }
  return async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timeout.unref?.();
    const abort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener("abort", abort, { once: true });
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", abort);
    }
  };
}
