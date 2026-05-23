import { useQuery } from '@tanstack/react-query';
import type { Session, Block, ChatMessage } from '@shared/schema';

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

export function useSessionReplay({ channelId, requestedSessionId, notableOnly = false }: UseSessionReplayHookProps): UseSessionReplayReturn {

    const {
        data: session,
        isLoading: isSessionLoading,
        error: sessionError
    } = useQuery({
        queryKey: ['session', 'history', channelId, requestedSessionId],
        queryFn: async (): Promise<Session> => {
            const url = new URL('/api/sessions/history', window.location.origin);
            url.searchParams.append('channelId', channelId);
            if (requestedSessionId) url.searchParams.append('sessionId', requestedSessionId.toString());

            const res = await fetch(url.toString());
            if (!res.ok) throw new Error('Failed to fetch session');
            return res.json();
        },
        enabled: !!channelId,
    });

    const {
        data: blocks,
        isLoading: isBlocksLoading,
        error: blocksError
    } = useQuery({
        queryKey: ['blocks', 'history', session?.id, notableOnly],
        queryFn: async (): Promise<BlockWithChats[]> => {
            const url = new URL('/api/blocks/history', window.location.origin);
            url.searchParams.append('sessionId', session!.id.toString());
            if (notableOnly) url.searchParams.append('notableOnly', 'true');

            const res = await fetch(url.toString());
            if (!res.ok) throw new Error('Failed to fetch blocks');
            return res.json();
        },
        enabled: !!session?.id,
    });

    return {
        session,
        blocks,
        isLoading: isSessionLoading || isBlocksLoading,
        error: sessionError || blocksError,
    };
}