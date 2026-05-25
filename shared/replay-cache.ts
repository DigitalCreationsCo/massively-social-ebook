import { LRUCache } from "lru-cache";
import type { Block, ChatMessage } from "@shared/schema";

export type BlockWithChats = Block & {
  chats: ChatMessage[];
};

interface ReplayCacheEntry {
  data: BlockWithChats[];
  createdAt: number;
}

const REPLAY_CACHE_TTL_MS = 60_000;

export const replayCache = new LRUCache<string, ReplayCacheEntry>({
  max: 500,
  ttl: REPLAY_CACHE_TTL_MS,

  // protects process memory
  maxSize: 50 * 1024 * 1024,

  sizeCalculation: (value) => {
    return JSON.stringify(value).length;
  },
});

export function buildReplayCacheKey(sessionId: number, notableOnly: boolean) {
  return `replay:${sessionId}:${notableOnly}`;
}
