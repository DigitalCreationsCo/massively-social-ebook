import {
  Chat,
  InMemoryFanoutBus,
  normalizeExternalStreamEndpoint,
  generateUUID,
  type ChatMessage as FanoutChatMessage,
  type ExternalChatEvent,
} from "@portalshq/capability-realtime-fanout";
import type { ChatMessage as StoredChatMessage, WsMessage } from "@shared/schema";

import { logger } from "../logger";
import { storage } from "../storage";
import type { BroadcastChannelConfig } from "../broadcast/config";

export interface AppChatAuthor {
  authorId: string;
  displayName: string;
}

export class ChatGateway {
  private readonly bus = new InMemoryFanoutBus({
    onSubscriberError: (cause, topic) => logger.error(
      `Chat subscriber failed for ${topic}`,
      "chat",
      cause instanceof Error ? cause : new Error(String(cause)),
    ),
  });
  private readonly chat = new Chat(this.bus);
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    private readonly configs: Map<string, BroadcastChannelConfig>,
    private readonly broadcast: (channelId: string, message: WsMessage) => void,
  ) {}

  async initialize(): Promise<void> {
    for (const config of this.configs.values()) {
      const unsubscribe = await this.chat.onMessage(config.endpoint, (message) => {
        this.broadcast(config.channelId, {
          type: "CHAT_MESSAGE",
          payload: toWebSocketChat(message),
        });
      });
      this.unsubscribe.push(unsubscribe);
    }
  }

  async sendAppMessage(
    channelId: string,
    author: AppChatAuthor,
    text: string,
    clientId?: string,
  ): Promise<StoredChatMessage> {
    const config = this.requireConfig(channelId);
    const normalizedText = normalizeText(text);
    const messageId = `portals:${generateUUID()}`;
    const sentAt = new Date();
    const activeSession = await storage.getActiveSession(channelId);
    const nextSession = activeSession ? undefined : await storage.getNextSession(channelId);
    const { message: stored } = await storage.createChatIfAbsent({
      channelId,
      sessionId: activeSession?.id ?? nextSession?.id,
      blockId: null,
      username: author.displayName,
      messageId,
      authorId: author.authorId,
      authorDisplayName: author.displayName,
      text: normalizedText,
      sentAt,
      provenance: { kind: "portals" },
    });
    await this.chat.send({
      messageId,
      sessionId: config.endpoint,
      authorId: author.authorId,
      authorDisplayName: author.displayName,
      text: normalizedText,
      sentAt: sentAt.toISOString(),
      provenance: { kind: "portals" },
      extracted: { storedId: stored.id, channelId, ...(clientId ? { clientId } : {}) },
    });
    return stored;
  }

  async ingestExternal(channelId: string, event: Omit<ExternalChatEvent, "streamEndpoint">): Promise<StoredChatMessage> {
    const config = this.requireConfig(channelId);
    const normalized = normalizeExternalEvent({ ...event, streamEndpoint: config.endpoint });
    const sentAt = new Date(normalized.sentAt);
    const activeSession = await storage.getActiveSession(channelId);
    const { message: stored, inserted } = await storage.createChatIfAbsent({
      channelId,
      sessionId: activeSession?.id,
      blockId: null,
      username: normalized.authorDisplayName || normalized.authorId,
      messageId: normalized.messageId,
      authorId: normalized.authorId,
      authorDisplayName: normalized.authorDisplayName,
      text: normalized.text,
      sentAt,
      provenance: normalized.provenance,
    });
    if (inserted) {
      await this.chat.send({
        ...normalized,
        extracted: { storedId: stored.id, channelId },
      });
    }
    return stored;
  }

  shutdown(): void {
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
  }

  private requireConfig(channelId: string): BroadcastChannelConfig {
    const config = this.configs.get(channelId);
    if (!config) throw new Error(`Channel ${channelId} has no broadcast configuration`);
    return config;
  }
}

function normalizeExternalEvent(event: ExternalChatEvent): FanoutChatMessage {
  const provider = event.provider.trim();
  const providerMessageId = event.providerMessageId.trim();
  const authorId = event.authorId.trim();
  const text = event.text.trim();
  if (!provider || !providerMessageId || !authorId || !text) {
    throw new Error("provider, providerMessageId, authorId, and text are required");
  }
  const sentAt = new Date(event.sentAt);
  if (Number.isNaN(sentAt.getTime())) throw new Error("sentAt must be a valid date-time");
  return {
    messageId: `external:${provider}:${providerMessageId}`,
    sessionId: normalizeExternalStreamEndpoint(event.streamEndpoint),
    authorId: `external:${provider}:${authorId}`,
    authorDisplayName: event.authorDisplayName?.trim() || undefined,
    text,
    sentAt: sentAt.toISOString(),
    provenance: { kind: "external", provider, providerMessageId },
  };
}

function toWebSocketChat(message: FanoutChatMessage) {
  const storedId = Number(message.extracted?.storedId);
  return {
    id: Number.isFinite(storedId) ? storedId : 0,
    messageId: message.messageId,
    channelId: String(message.extracted?.channelId ?? ""),
    sessionId: null,
    blockId: null,
    username: message.authorDisplayName || message.authorId,
    authorId: message.authorId,
    authorDisplayName: message.authorDisplayName ?? null,
    text: message.text,
    sentAt: message.sentAt,
    createdAt: message.sentAt,
    provenance: message.provenance,
    ...(typeof message.extracted?.clientId === "string" ? { clientId: message.extracted.clientId } : {}),
  };
}

function normalizeText(text: string): string {
  const normalized = text.trim();
  if (!normalized) throw new TypeError("Chat text is required");
  if (normalized.length > 200) throw new TypeError("Chat text cannot exceed 200 characters");
  return normalized;
}
