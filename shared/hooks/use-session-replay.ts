import { useQuery } from "@tanstack/react-query";
import type { Session, Block, ChatMessage } from "@shared/schema";

export interface TailFocusOptions {
  /** Max blocks to return (default: 12, matches server LIMIT) */
  numBlocks?: number;
  /** Percentage into the blocks to start (0-100, default: 50 = middle) */
  startPercent?: number;
  /**
   * If true (default): take from `startPercent`-mark to the end.
   * If false: take `numBlocks` from the beginning.
   */
  fromEnd?: boolean;
}

interface UseSessionReplayHookProps {
  channelId: string;
  requestedSessionId?: number;
  notableOnly?: boolean;
  /** Optionally narrow which blocks are shown (tail-focus, count cap). */
  tailFocus?: TailFocusOptions;
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

/**
 * Slice `blocks` to focus on the tail end of a session's history.
 * When `fromEnd` (default): start at the `startPercent` mark (e.g. 50% = middle)
 * and take up to `numBlocks`.
 * When `!fromEnd`: take up to `numBlocks` from the beginning.
 */
function applyTailFocus(
  blocks: BlockWithChats[],
  options?: TailFocusOptions,
): BlockWithChats[] {
  if (!options || blocks.length === 0) return blocks;

  const { numBlocks = 12, startPercent = 50, fromEnd = true } = options;

  if (fromEnd) {
    const startIndex = Math.min(
      Math.floor(blocks.length * (startPercent / 100)),
      Math.max(0, blocks.length - 1),
    );
    return blocks.slice(startIndex).slice(0, numBlocks);
  }

  // fromStart mode: take from the beginning
  return blocks.slice(0, numBlocks);
}

async function fetchSessionReplay(
  channelId: string,
  requestedSessionId: number | undefined,
  notableOnly: boolean,
  tailFocus?: TailFocusOptions,
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

    return { session, blocks: applyTailFocus(blocks, tailFocus) };
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
  return { session, blocks: applyTailFocus(blocks, tailFocus) };
}

export function useSessionReplay({
  channelId,
  requestedSessionId,
  notableOnly = false,
  tailFocus,
}: UseSessionReplayHookProps): UseSessionReplayReturn {
  const { data, isLoading, error } = useQuery({
    // Include tailFocus in the key so changing options triggers a fresh fetch.
    queryKey: [
      "session-replay",
      channelId,
      requestedSessionId,
      notableOnly,
      tailFocus,
    ],
    queryFn: () =>
      fetchSessionReplay(channelId, requestedSessionId, notableOnly, tailFocus),
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
