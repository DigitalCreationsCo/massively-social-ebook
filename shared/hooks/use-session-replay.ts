import { useQuery } from "@tanstack/react-query";
import type { Session, Block, ChatMessage } from "@shared/schema";

interface UseSessionReplayHookProps {
  channelId: string;
  requestedSessionId?: number;
  notableOnly?: boolean;
}

/** A history block returned with embedded chat messages (top 10). */
export type BlockWithChats = Block & {
  chats: ChatMessage[];
};

export interface UseSessionReplayReturn {
  session: Session | undefined;
  blocks: BlockWithChats[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useSessionReplay({
  channelId,
  requestedSessionId,
  notableOnly = false,
}: UseSessionReplayHookProps): UseSessionReplayReturn {
  const {
    data: session,
    isLoading: isSessionLoading,
    error: sessionError,
  } = useQuery({
    queryKey: ["session", "history", channelId, requestedSessionId],
    queryFn: async (): Promise<Session | null> => {
      const url = new URL("/api/sessions/history", window.location.origin);
      url.searchParams.append("channelId", channelId);
      if (requestedSessionId)
        url.searchParams.append("sessionId", requestedSessionId.toString());

      const res = await fetch(url.toString());
      // 404 means no completed sessions exist — not a real error.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch session history");
      return res.json();
    },
    enabled: !!channelId,
    staleTime: Infinity,
  });

  const sessionId = session?.id;

  const {
    data: blocks,
    isLoading: isBlocksLoading,
    error: blocksError,
  } = useQuery({
    queryKey: ["blocks", "history", sessionId, notableOnly],
    queryFn: async (): Promise<BlockWithChats[]> => {
      if (!sessionId) throw new Error("No session ID — cannot fetch blocks");

      const url = new URL("/api/blocks/history", window.location.origin);
      url.searchParams.append("sessionId", sessionId.toString());
      if (notableOnly) url.searchParams.append("notableOnly", "true");

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch historical blocks");
      return res.json();
    },
    enabled: !!sessionId,
    staleTime: Infinity,
  });

  // Log errors — this hook's consumer currently ignores `error`.
  if (sessionError) {
    console.error(
      "[useSessionReplay] Failed to fetch session history for channel",
      channelId,
      sessionError,
    );
  }
  if (blocksError) {
    console.error(
      "[useSessionReplay] Failed to fetch historical blocks for session",
      sessionId,
      blocksError,
    );
  }

  return {
    // Normalise null from the 404 case into undefined for the consumer.
    session: session ?? undefined,
    blocks,
    isLoading: isSessionLoading || isBlocksLoading,
    error: sessionError || blocksError,
  };
}
