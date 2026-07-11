import { useQuery } from "@tanstack/react-query";
import type { Session, Block, ChatMessage } from "@shared/schema";

export interface TailFocusOptions {
  /**
   * Max blocks to return (default: 12).
   */
  numBlocks?: number;
  /**
   * Query direction (default: 'end').
   *
   * - 'end'   → last `numBlocks` blocks of the session.
   * - 'start' → first `numBlocks` blocks of the session.
   *
   * Combined with `startPercent`:
   *   - 'start' + startPercent → beginning up to the P% mark (up to numBlocks).
   *   - 'end'   + startPercent → P% mark to the last block (up to numBlocks).
   */
  direction?: "start" | "end";
  /**
   * Percentage boundary (0–100).
   * - 'start' mode: return blocks from the beginning up to the P% position.
   * - 'end'   mode: return blocks from the P% position to the end.
   * Omit for a pure head/tail query (first or last N blocks).
   */
  startPercent?: number;
}

interface UseSessionReplayHookProps {
  channelId: string;
  requestedSessionId?: number;
  notableOnly?: boolean;
  /** Optionally narrow which blocks are shown (direction, count cap, percent pivot). */
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
 * Client-side safety cap.
 * The server applies direction/startPercent logic; this only enforces the
 * numBlocks ceiling on whatever the server returns.
 */
function applyTailFocus(
  blocks: BlockWithChats[],
  options?: TailFocusOptions,
): BlockWithChats[] {
  if (!options || blocks.length === 0) return blocks;
  const { numBlocks = 12 } = options;
  return blocks.slice(0, numBlocks);
}

/**
 * Construct the blocks API URL, encoding all TailFocusOptions as query params
 * so the server can handle direction and startPercent offset math.
 */
function buildBlocksUrl(
  sessionId: number,
  notableOnly: boolean,
  tailFocus?: TailFocusOptions,
): string {
  const url = new URL("/api/blocks/history", window.location.origin);
  url.searchParams.append("sessionId", sessionId.toString());
  if (notableOnly) url.searchParams.append("notableOnly", "true");

  const { numBlocks = 12, direction = "end", startPercent } = tailFocus ?? {};
  url.searchParams.append("limit", String(numBlocks));
  url.searchParams.append("direction", direction);
  if (startPercent !== undefined)
    url.searchParams.append("startPercent", String(startPercent));

  return url.toString();
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
    const [ sessionRes, blocksRes ] = await Promise.all([
      fetch(sessionUrl.toString()),
      fetch(buildBlocksUrl(requestedSessionId, notableOnly, tailFocus)),
    ]);

    if (sessionRes.status === 404) return { session: null, blocks: [] };
    if (!sessionRes.ok) throw new Error("Failed to fetch session history");
    if (!blocksRes.ok) throw new Error("Failed to fetch historical blocks");

    const [ session, blocks ] = await Promise.all([
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

  const blocksRes = await fetch(
    buildBlocksUrl(session.id, notableOnly, tailFocus),
  );
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