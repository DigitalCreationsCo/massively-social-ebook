import WebSocket from "ws";

import type { TwitchBroadcastConfig } from "../../broadcast/config";
import { requireSecret } from "../../broadcast/config";
import { logger } from "../../logger";
import type { ChatGateway } from "../gateway";
import { refreshAccessToken, waitForReconnect } from "./oauth";

const DEFAULT_EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws";

export class TwitchChatConnector {
  private controller: AbortController | undefined;
  private runPromise: Promise<void> | undefined;
  private socket: WebSocket | undefined;
  private token: { accessToken: string; expiresAt: number } | undefined;

  constructor(
    private readonly channelId: string,
    private readonly config: TwitchBroadcastConfig,
    private readonly gateway: ChatGateway,
  ) {}

  start(): void {
    if (this.runPromise) return;
    const controller = new AbortController();
    this.controller = controller;
    this.runPromise = this.run(controller.signal).finally(() => {
      if (this.controller === controller) this.controller = undefined;
      this.runPromise = undefined;
    });
  }

  async stop(): Promise<void> {
    this.controller?.abort(new Error("Twitch connector stopped"));
    this.socket?.close();
    await this.runPromise?.catch(() => undefined);
  }

  private async run(signal: AbortSignal): Promise<void> {
    let retry = 0;
    let url = DEFAULT_EVENTSUB_URL;
    while (!signal.aborted) {
      try {
        url = await this.connect(url, signal) || DEFAULT_EVENTSUB_URL;
        retry = 0;
      } catch (cause) {
        if (signal.aborted) return;
        retry += 1;
        logger.warn(
          `Twitch chat reconnect ${retry} for ${this.channelId}`,
          "chat",
          cause instanceof Error ? cause : new Error(String(cause)),
        );
        await waitForReconnect(Math.min(30_000, 1_000 * 2 ** Math.min(retry - 1, 5)), signal);
        url = DEFAULT_EVENTSUB_URL;
      }
    }
  }

  private connect(url: string, signal: AbortSignal): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let reconnectUrl: string | undefined;
      let keepaliveTimer: NodeJS.Timeout | undefined;
      const resetKeepalive = (seconds = 30) => {
        if (keepaliveTimer) clearTimeout(keepaliveTimer);
        keepaliveTimer = setTimeout(() => socket.terminate(), (seconds + 5) * 1_000);
        keepaliveTimer.unref?.();
      };
      const aborted = () => socket.close();
      signal.addEventListener("abort", aborted, { once: true });

      socket.on("message", async (raw) => {
        try {
          const payload = JSON.parse(raw.toString()) as TwitchEnvelope;
          resetKeepalive(payload.payload?.session?.keepalive_timeout_seconds ?? 30);
          if (payload.metadata?.message_type === "session_welcome" && payload.payload?.session?.id) {
            await this.subscribe(payload.payload.session.id);
          } else if (payload.metadata?.message_type === "session_reconnect") {
            reconnectUrl = payload.payload?.session?.reconnect_url || undefined;
            socket.close();
          } else if (payload.metadata?.message_type === "notification") {
            const event = payload.payload?.event;
            if (event?.message_id && event?.chatter_user_id && event?.message?.text) {
              await this.gateway.ingestExternal(this.channelId, {
                provider: "twitch",
                providerMessageId: event.message_id,
                authorId: event.chatter_user_id,
                authorDisplayName: event.chatter_user_name,
                text: event.message.text,
                sentAt: payload.metadata.message_timestamp || new Date().toISOString(),
              });
            }
          } else if (payload.metadata?.message_type === "revocation") {
            throw new Error("Twitch chat subscription was revoked");
          }
        } catch (cause) {
          logger.error(
            `Twitch chat message failed for ${this.channelId}`,
            "chat",
            cause instanceof Error ? cause : new Error(String(cause)),
          );
          socket.close();
        }
      });
      socket.once("error", reject);
      socket.once("close", () => {
        if (keepaliveTimer) clearTimeout(keepaliveTimer);
        signal.removeEventListener("abort", aborted);
        if (this.socket === socket) this.socket = undefined;
        if (signal.aborted) resolve(undefined);
        else if (reconnectUrl) resolve(reconnectUrl);
        else reject(new Error("Twitch EventSub socket closed"));
      });
    });
  }

  private async subscribe(sessionId: string): Promise<void> {
    const accessToken = await this.getToken();
    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": requireSecret(this.config.clientIdEnv, "Twitch client id"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "channel.chat.message",
        version: "1",
        condition: {
          broadcaster_user_id: this.config.broadcasterUserId,
          user_id: this.config.userId,
        },
        transport: { method: "websocket", session_id: sessionId },
      }),
    });
    if (response.status === 401) this.token = undefined;
    if (!response.ok && response.status !== 409) {
      throw new Error(`Twitch EventSub subscription failed (${response.status})`);
    }
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt - Date.now() > 60_000) return this.token.accessToken;
    this.token = await refreshAccessToken("https://id.twitch.tv/oauth2/token", this.config);
    return this.token.accessToken;
  }
}

interface TwitchEnvelope {
  metadata: { message_type?: string; message_timestamp?: string };
  payload?: {
    session?: { id?: string; keepalive_timeout_seconds?: number; reconnect_url?: string | null };
    event?: {
      message_id?: string;
      chatter_user_id?: string;
      chatter_user_name?: string;
      message?: { text?: string };
    };
  };
}
