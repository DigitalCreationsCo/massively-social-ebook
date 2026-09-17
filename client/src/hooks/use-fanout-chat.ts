import type { QueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { ChatMessage } from "./use-live-channel";

/**
 * Shared fanout/chat primitives for the live hooks.
 *
 * Mirrors the server concepts (`FanoutHub` delivery + `Chat` message flow:
 * optimistic send with `clientId`, then `CHAT_MESSAGE` / `CHAT_ACK` /
 * `CHAT_REJECTED`). Both `use-live-channel` and `use-live-state` implement
 * this same flow; this module keeps the query-cache transitions in one
 * place so the hooks stay thin.
 */

export function fanoutBackoffDelay(attempts: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 5)) + Math.random() * 500;
}

export function buildWsUrl(channelId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const configuredBase = import.meta.env.VITE_WS_URL
    ? `${import.meta.env.VITE_WS_URL}/ws`
    : `${protocol}//${window.location.host || "localhost:5001"}/ws`;
  return `${configuredBase}?channelId=${encodeURIComponent(channelId)}`;
}

export function applyChatMessage(
  queryClient: QueryClient,
  channelId: string,
  incoming: ChatMessage,
  pendingClientIds: Map<string, number>,
): void {
  queryClient.setQueryData<ChatMessage[]>([api.chat.history.path, channelId], (old = []) => {
    if (incoming.clientId && pendingClientIds.has(incoming.clientId)) {
      const optimisticId = pendingClientIds.get(incoming.clientId)!;
      pendingClientIds.delete(incoming.clientId);
      return old.map((entry) => (entry.id === optimisticId ? incoming : entry));
    }
    if (old.some((entry) => entry.messageId === incoming.messageId)) return old;
    return [...old, incoming];
  });
}

export function applyChatAck(
  queryClient: QueryClient,
  channelId: string,
  payload: { clientId?: string; messageId: string },
  pendingClientIds: Map<string, number>,
): void {
  if (!payload.clientId) return;
  const optimisticId = pendingClientIds.get(payload.clientId);
  if (!optimisticId) return;
  queryClient.setQueryData<ChatMessage[]>([api.chat.history.path, channelId], (old = []) =>
    old.map((entry) => (entry.id === optimisticId ? { ...entry, messageId: payload.messageId } : entry)),
  );
}

export function applyChatRejected(
  queryClient: QueryClient,
  channelId: string,
  payload: { clientId?: string },
  pendingClientIds: Map<string, number>,
): number | null {
  if (!payload.clientId) return null;
  const optimisticId = pendingClientIds.get(payload.clientId);
  pendingClientIds.delete(payload.clientId);
  if (optimisticId) {
    queryClient.setQueryData<ChatMessage[]>([api.chat.history.path, channelId], (old = []) =>
      old.filter((entry) => entry.id !== optimisticId),
    );
  }
  return optimisticId ?? null;
}
