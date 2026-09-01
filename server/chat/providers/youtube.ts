import { logger } from "../../logger";
import type { YoutubeBroadcastConfig } from "../../broadcast/config";
import type { ChatGateway } from "../gateway";
import { refreshAccessToken, waitForReconnect } from "./oauth";

interface YoutubeStreamPayload {
  items?: Array<{
    id?: string;
    snippet?: { displayMessage?: string; publishedAt?: string };
    authorDetails?: { channelId?: string; displayName?: string };
  }>;
}

export class YoutubeChatConnector {
  private controller: AbortController | undefined;
  private runPromise: Promise<void> | undefined;
  private token: { accessToken: string; expiresAt: number } | undefined;

  constructor(
    private readonly channelId: string,
    private readonly config: YoutubeBroadcastConfig,
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
    this.controller?.abort(new Error("YouTube connector stopped"));
    await this.runPromise?.catch(() => undefined);
  }

  private async run(signal: AbortSignal): Promise<void> {
    let retry = 0;
    while (!signal.aborted) {
      try {
        const accessToken = await this.getToken();
        const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages/stream");
        url.searchParams.set("liveChatId", this.config.liveChatId);
        url.searchParams.set("part", "id,snippet,authorDetails");
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
          signal,
        });
        if (response.status === 401) this.token = undefined;
        if (!response.ok || !response.body) throw new Error(`YouTube chat stream failed (${response.status})`);
        retry = 0;
        for await (const payload of parseYoutubeJsonStream(response.body, signal)) {
          for (const item of payload.items ?? []) {
            if (!item.id || !item.snippet?.displayMessage || !item.authorDetails?.channelId) continue;
            await this.gateway.ingestExternal(this.channelId, {
              provider: "youtube-live",
              providerMessageId: item.id,
              authorId: item.authorDetails.channelId,
              authorDisplayName: item.authorDetails.displayName,
              text: item.snippet.displayMessage,
              sentAt: item.snippet.publishedAt || new Date().toISOString(),
            });
          }
        }
        if (!signal.aborted) throw new Error("YouTube chat stream ended");
      } catch (cause) {
        if (signal.aborted) return;
        retry += 1;
        logger.warn(
          `YouTube chat reconnect ${retry} for ${this.channelId}`,
          "chat",
          cause instanceof Error ? cause : new Error(String(cause)),
        );
        await waitForReconnect(Math.min(30_000, 1_000 * 2 ** Math.min(retry - 1, 5)), signal);
      }
    }
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt - Date.now() > 60_000) return this.token.accessToken;
    this.token = await refreshAccessToken("https://oauth2.googleapis.com/token", this.config);
    return this.token.accessToken;
  }
}

export async function* parseYoutubeJsonStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<YoutubeStreamPayload> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let scanIndex = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let index = scanIndex; index < buffer.length; index++) {
        const character = buffer[index];
        if (escaped) { escaped = false; continue; }
        if (quoted && character === "\\") { escaped = true; continue; }
        if (character === '"') { quoted = !quoted; continue; }
        if (quoted) continue;
        if (character === "{") {
          if (depth === 0) start = index;
          depth += 1;
        } else if (character === "}" && depth > 0) {
          depth -= 1;
          if (depth === 0 && start >= 0) {
            const json = buffer.slice(start, index + 1);
            yield JSON.parse(json) as YoutubeStreamPayload;
            buffer = buffer.slice(index + 1);
            index = -1;
            scanIndex = 0;
            start = -1;
          }
        }
      }
      scanIndex = buffer.length;
    }
  } finally {
    reader.releaseLock();
  }
}
