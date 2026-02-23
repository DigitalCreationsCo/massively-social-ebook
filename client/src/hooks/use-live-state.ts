import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/routes';
import { generateGuestName } from '@/lib/utils';
import { useToast } from './use-toast';

// Types derived from schema
export type Phase = 'reading' | 'voting';

export interface StoryState {
  id: number;
  content: string;
  imageUrl: string | null;
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

export function useLiveState() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Session state
  const [username] = useState(() => {
    const stored = sessionStorage.getItem('reader_name');
    if (stored) return stored;
    const newName = generateGuestName();
    sessionStorage.setItem('reader_name', newName);
    return newName;
  });

  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Local timer state for smooth UI ticking without waiting for WS syncs
  const [localTimeRemaining, setLocalTimeRemaining] = useState(0);

  // Fetch initial REST state
  const { data: currentBlock, isLoading: blockLoading } = useQuery({
    queryKey: [api.blocks.current.path],
    queryFn: async () => {
      const res = await fetch(api.blocks.current.path);
      if (!res.ok) throw new Error('Failed to fetch current block');
      return res.json() as Promise<StoryState>;
    },
  });

  const { data: chatHistory = [], isLoading: chatLoading } = useQuery({
    queryKey: [api.chat.history.path],
    queryFn: async () => {
      const res = await fetch(api.chat.history.path);
      if (!res.ok) throw new Error('Failed to fetch chat history');
      return res.json() as Promise<ChatMsg[]>;
    },
  });

  // Sync local timer with server state
  useEffect(() => {
    if (currentBlock?.timeRemaining !== undefined) {
      setLocalTimeRemaining(currentBlock.timeRemaining);
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

  // WebSocket Connection & Handling
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const connect = () => {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsConnected(true);
        console.log('[LiveState] Connected to Realtime Broadcast');
      };

      socket.onclose = () => {
        setWsConnected(false);
        // Exponential backoff reconnect could go here
        setTimeout(connect, 3000);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'sync_state') {
            const payload = message.payload as StoryState;
            queryClient.setQueryData([api.blocks.current.path], payload);
          } 
          else if (message.type === 'chat_message') {
            const payload = message.payload as ChatMsg;
            queryClient.setQueryData<ChatMsg[]>([api.chat.history.path], (old = []) => {
              // Prevent duplicates
              if (old.some(m => m.id === payload.id)) return old;
              return [...old, payload];
            });
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
  }, [queryClient]);

  // Actions
  const submitChat = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast({ title: "Connection lost", description: "Trying to reconnect...", variant: "destructive" });
      return;
    }
    
    // Optimistic local append (optional, but makes it feel faster)
    const tempMsg: ChatMsg = {
      id: Date.now(), // temporary
      username,
      text,
      createdAt: new Date().toISOString()
    };
    queryClient.setQueryData<ChatMsg[]>([api.chat.history.path], (old = []) => [...old, tempMsg]);

    wsRef.current.send(JSON.stringify({
      type: 'submit_chat',
      payload: { username, text }
    }));
  }, [username, queryClient, toast]);

  const submitVote = useCallback((choice: 'A' | 'B') => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast({ title: "Vote failed", description: "You are offline.", variant: "destructive" });
      return;
    }
    
    // Optimistically record vote to disable buttons locally
    sessionStorage.setItem(`voted_${currentBlock?.id}`, choice);
    
    wsRef.current.send(JSON.stringify({
      type: 'submit_vote',
      payload: { choice, blockId: currentBlock?.id }
    }));
    
    toast({ 
      title: "Vote cast!", 
      description: `You chose Path ${choice}.`,
      duration: 2000 
    });
  }, [currentBlock?.id, toast]);

  const hasVotedCurrent = sessionStorage.getItem(`voted_${currentBlock?.id}`) !== null;

  return {
    isLoading: blockLoading || chatLoading,
    wsConnected,
    username,
    currentBlock,
    localTimeRemaining,
    chatHistory,
    hasVotedCurrent,
    submitChat,
    submitVote
  };
}
