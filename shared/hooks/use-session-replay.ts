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

interface SessionReplayData {
  session: Session | null;
  blocks: BlockWithChats[];
}

async function fetchSessionReplay(
  channelId: string,
  requestedSessionId: number | undefined,
  notableOnly: boolean,
): Promise<SessionReplayData> {
  const sessionUrl = new URL("/api/sessions/history", window.location.origin);
  sessionUrl.searchParams.append("channelId", channelId);
  if (requestedSessionId)
    sessionUrl.searchParams.append("sessionId", requestedSessionId.toString());

  // When we already know the session ID we can fire both requests in parallel.
  if (requestedSessionId) {
    const blocksUrl = new URL("/api/blocks/history", window.location.origin);
    blocksUrl.searchParams.append("sessionId", requestedSessionId.toString());
    if (notableOnly) blocksUrl.searchParams.append("notableOnly", "true");

    const [sessionRes, blocksRes] = await Promise.all([
      fetch(sessionUrl.toString()),
      fetch(blocksUrl.toString()),
    ]);

    if (sessionRes.status === 404) return { session: null, blocks: [] };
    if (!sessionRes.ok) throw new Error("Failed to fetch session history");
    if (!blocksRes.ok) throw new Error("Failed to fetch historical blocks");

    const [session, blocks] = await Promise.all([
      sessionRes.json() as Promise<Session>,
      blocksRes.json() as Promise<BlockWithChats[]>,
    ]);

    return { session, blocks };
  }

  // No session ID yet — fetch session first, then blocks.
  const sessionRes = await fetch(sessionUrl.toString());
  if (sessionRes.status === 404) return { session: null, blocks: [] };
  if (!sessionRes.ok) throw new Error("Failed to fetch session history");

  const session = (await sessionRes.json()) as Session;

  const blocksUrl = new URL("/api/blocks/history", window.location.origin);
  blocksUrl.searchParams.append("sessionId", session.id.toString());
  if (notableOnly) blocksUrl.searchParams.append("notableOnly", "true");

  const blocksRes = await fetch(blocksUrl.toString());
  if (!blocksRes.ok) throw new Error("Failed to fetch historical blocks");

  const blocks = (await blocksRes.json()) as BlockWithChats[];
  return { session, blocks };
}

export function useSessionReplay({
  channelId,
  requestedSessionId,
  notableOnly = false,
}: UseSessionReplayHookProps): UseSessionReplayReturn {
  const { data, isLoading, error } = useQuery({
    // Include notableOnly in the key so toggling it triggers a fresh fetch.
    queryKey: ["session-replay", channelId, requestedSessionId, notableOnly],
    queryFn: () =>
      fetchSessionReplay(channelId, requestedSessionId, notableOnly),
    enabled: !!channelId,
    staleTime: Infinity,
  });

  if (error) {
    console.error(
      "[useSessionReplay] Failed to fetch session replay for channel",
      channelId,
      error,
    );
  }

  return {
    session: data?.session ?? undefined,
    blocks: data?.blocks,
    isLoading,
    error,
  };
}
