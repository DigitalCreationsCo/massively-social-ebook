import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/routes';
import { generateGuestName } from '@/lib/utils';
import { useToast } from './use-toast';

export type Phase = 'reading' | 'voting';

export interface VoteOption {
  label: string;
  description: string;
}

export interface StoryState {
  id: number;
  channelId: string;
  title: string | null;
  content: string;
  imageUrl: string | null;
  optionA: VoteOption | null;
  optionB: VoteOption | null;
  createdAt: string;
  phase: Phase;
  timeRemaining: number;
}

export interface ChatMsg {
  id: number;
  username: string;
  text: string;
  createdAt: string;
}

export interface VoteResults {
  A: number;
  B: number;
}

export function useLiveState(channelId: string = 'scifi') {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [username] = useState(() => {
    const stored = sessionStorage.getItem('reader_name');
    if (stored) return stored;
    const newName = generateGuestName();
    sessionStorage.setItem('reader_name', newName);
    return newName;
  });

  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [localTimeRemaining, setLocalTimeRemaining] = useState(0);
  const [voteResults, setVoteResults] = useState<VoteResults>({ A: 0, B: 0 });
  const [viewerCount, setViewerCount] = useState(() => 1247 + Math.floor(Math.random() * 500));

  // Fetch initial REST state
  const { data: currentBlock, isLoading: blockLoading } = useQuery({
    queryKey: [api.blocks.current.path, channelId],
    queryFn: async () => {
      const res = await fetch(`${api.blocks.current.path}?channelId=${channelId}`);
      if (!res.ok) throw new Error('Failed to fetch current block');
      return res.json() as Promise<StoryState>;
    },
  });

  const { data: chatHistory = [], isLoading: chatLoading } = useQuery({
    queryKey: [api.chat.history.path, channelId],
    queryFn: async () => {
      const res = await fetch(`${api.chat.history.path}?channelId=${channelId}`);
      if (!res.ok) throw new Error('Failed to fetch chat history');
      return res.json() as Promise<ChatMsg[]>;
    },
  });

  // Sync local timer with server state
  useEffect(() => {
    if (currentBlock?.timeRemaining !== undefined) {
      setLocalTimeRemaining(Math.floor(currentBlock.timeRemaining / 1000));
    }
  }, [currentBlock?.timeRemaining, currentBlock?.phase, currentBlock?.id]);

  // Local countdown interval
  useEffect(() => {
    if (localTimeRemaining <= 0) return;
    
    const interval = setInterval(() => {
      setLocalTimeRemaining(prev => Math.max(0, prev - 1));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [localTimeRemaining]);

  // Simulate viewer count fluctuations
  useEffect(() => {
    const interval = setInterval(() => {
      setViewerCount(prev => {
        const change = Math.floor(Math.random() * 21) - 10;
        return Math.max(100, prev + change);
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // WebSocket Connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?channelId=${channelId}`;
    
    const connect = () => {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsConnected(true);
        console.log('[LiveState] Connected to channel:', channelId);
      };

      socket.onclose = () => {
        setWsConnected(false);
        setTimeout(connect, 3000);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'sync_state') {
            const payload = message.payload as StoryState;
            queryClient.setQueryData([api.blocks.current.path, channelId], payload);
          } 
          else if (message.type === 'chat_message') {
            const payload = message.payload as ChatMsg;
            queryClient.setQueryData<ChatMsg[]>([api.chat.history.path, channelId], (old = []) => {
              if (old.some(m => m.id === payload.id)) return old;
              return [...old, payload];
            });
          }
          else if (message.type === 'vote_update') {
            const payload = message.payload as VoteResults;
            setVoteResults(payload);
          }
        } catch (err) {
          console.error('[LiveState] Failed to parse WS message:', err);
        }
      };
    };

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [queryClient, channelId]);

  const submitChat = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast({ title: "Connection lost", description: "Trying to reconnect...", variant: "destructive" });
      return;
    }
    
    const tempMsg: ChatMsg = {
      id: Date.now(),
      username,
      text,
      createdAt: new Date().toISOString()
    };
    queryClient.setQueryData<ChatMsg[]>([api.chat.history.path, channelId], (old = []) => [...old, tempMsg]);

    wsRef.current.send(JSON.stringify({
      type: 'submit_chat',
      payload: { username, text }
    }));
  }, [username, queryClient, toast, channelId]);

  const submitVote = useCallback((choice: 'A' | 'B') => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast({ title: "Vote failed", description: "You are offline.", variant: "destructive" });
      return;
    }
    
    sessionStorage.setItem(`voted_${channelId}_${currentBlock?.id}`, choice);
    
    wsRef.current.send(JSON.stringify({
      type: 'submit_vote',
      payload: { choice, userId: username }
    }));
    
    // Update local vote results optimistically
    setVoteResults(prev => ({
      ...prev,
      [choice]: prev[choice] + 1
    }));
    
    toast({ 
      title: "Vote cast!", 
      description: `You chose ${currentBlock?.optionA && choice === 'A' ? currentBlock.optionA.label : currentBlock?.optionB?.label}.`,
      duration: 2000 
    });
  }, [currentBlock?.id, currentBlock?.optionA, currentBlock?.optionB, toast, username, channelId]);

  const hasVotedCurrent = sessionStorage.getItem(`voted_${channelId}_${currentBlock?.id}`) !== null;

  // Get most recent chat message
  const mostRecentMessage = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;

  return {
    isLoading: blockLoading || chatLoading,
    wsConnected,
    username,
    currentBlock,
    localTimeRemaining,
    chatHistory,
    hasVotedCurrent,
    submitChat,
    submitVote,
    voteResults,
    viewerCount,
    mostRecentMessage
  };
}
