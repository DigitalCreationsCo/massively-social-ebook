import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@shared/routes";
import { useToast } from "./use-toast";
import { generateClientUuid } from "@/lib/utils";

export interface ChatMessage {
  id: number;
  messageId: string;
  channelId: string;
  sessionId: number | null;
  blockId: number | null;
  username: string;
  authorId: string;
  authorDisplayName?: string | null;
  text: string;
  sentAt: string | Date;
  createdAt: string | Date;
  provenance: { kind: "portals" | "external"; provider?: string; providerMessageId?: string };
  clientId?: string;
}

interface ChatIdentity {
  authorId: string;
  displayName: string;
}

export function useLiveChannel(channelId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingClientIds = useRef(new Map<string, number>());

  const identityQuery = useQuery({
    queryKey: ["chat-identity"],
    queryFn: async () => {
      const response = await fetch("/api/chat/identity", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Unable to create a chat identity");
      return response.json() as Promise<ChatIdentity>;
    },
    staleTime: Infinity,
    retry: 2,
  });

  const historyQuery = useQuery({
    queryKey: [api.chat.history.path, channelId],
    queryFn: async () => {
      const response = await fetch(`${api.chat.history.path}?channelId=${encodeURIComponent(channelId)}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Unable to load chat history");
      return response.json() as Promise<ChatMessage[]>;
    },
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!channelId || !identityQuery.data) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const configuredBase = import.meta.env.VITE_WS_URL
      ? `${import.meta.env.VITE_WS_URL}/ws`
      : `${protocol}//${window.location.host || "localhost:5001"}/ws`;
    const wsUrl = `${configuredBase}?channelId=${encodeURIComponent(channelId)}`;

    const connect = () => {
      if (cancelled) return;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;
      socket.onopen = () => {
        attempts = 0;
        setWsConnected(true);
      };
      socket.onclose = () => {
        if (cancelled) return;
        setWsConnected(false);
        attempts += 1;
        reconnectTimer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** Math.min(attempts - 1, 5)) + Math.random() * 500);
      };
      socket.onerror = () => setWsConnected(false);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { type: string; payload?: any };
          if (message.type === "CHAT_MESSAGE") {
            const incoming = message.payload as ChatMessage;
            queryClient.setQueryData<ChatMessage[]>([api.chat.history.path, channelId], (old = []) => {
              if (incoming.clientId && pendingClientIds.current.has(incoming.clientId)) {
                const optimisticId = pendingClientIds.current.get(incoming.clientId)!;
                pendingClientIds.current.delete(incoming.clientId);
                return old.map((entry) => entry.id === optimisticId ? incoming : entry);
              }
              if (old.some((entry) => entry.messageId === incoming.messageId)) return old;
              return [...old, incoming];
            });
          } else if (message.type === "CHAT_ACK") {
            const { clientId, messageId } = message.payload as { clientId?: string; messageId: string };
            if (!clientId) return;
            const optimisticId = pendingClientIds.current.get(clientId);
            if (!optimisticId) return;
            queryClient.setQueryData<ChatMessage[]>([api.chat.history.path, channelId], (old = []) => old.map(
              (entry) => entry.id === optimisticId ? { ...entry, messageId } : entry,
            ));
          } else if (message.type === "CHAT_REJECTED") {
            const { clientId, message: reason } = message.payload as { clientId?: string; message?: string };
            if (clientId) {
              const optimisticId = pendingClientIds.current.get(clientId);
              pendingClientIds.current.delete(clientId);
              if (optimisticId) {
                queryClient.setQueryData<ChatMessage[]>([api.chat.history.path, channelId], (old = []) => old.filter(
                  (entry) => entry.id !== optimisticId,
                ));
              }
            }
            toast({ title: "Message not sent", description: reason || "Please try again.", variant: "destructive" });
          }
        } catch {
          // Ignore malformed events; the next valid event keeps the connection useful.
        }
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [channelId, identityQuery.data, queryClient, toast]);

  const submitChat = useCallback((text: string) => {
    const identity = identityQuery.data;
    const socket = wsRef.current;
    if (!identity || !socket || socket.readyState !== WebSocket.OPEN) {
      toast({ title: "Conversation reconnecting", description: "Your message was not sent yet.", variant: "destructive" });
      return;
    }
    const clientId = generateClientUuid();
    const optimisticId = -Date.now();
    const timestamp = new Date().toISOString();
    const optimistic: ChatMessage = {
      id: optimisticId,
      messageId: `pending:${clientId}`,
      channelId,
      sessionId: null,
      blockId: null,
      username: identity.displayName,
      authorId: identity.authorId,
      authorDisplayName: identity.displayName,
      text: text.trim(),
      sentAt: timestamp,
      createdAt: timestamp,
      provenance: { kind: "portals" },
      clientId,
    };
    pendingClientIds.current.set(clientId, optimisticId);
    queryClient.setQueryData<ChatMessage[]>([api.chat.history.path, channelId], (old = []) => [...old, optimistic]);
    socket.send(JSON.stringify({ type: "SUBMIT_CHAT", payload: { text, clientId } }));
  }, [channelId, identityQuery.data, queryClient, toast]);

  const chatHistory = historyQuery.data ?? [];
  const mostRecentMessage = useMemo(
    () => chatHistory.at(-1) ?? null,
    [chatHistory],
  );

  return {
    isLoading: identityQuery.isLoading || historyQuery.isLoading,
    wsConnected,
    username: identityQuery.data?.displayName ?? "Guest",
    chatHistory,
    mostRecentMessage,
    submitChat,
  };
}
