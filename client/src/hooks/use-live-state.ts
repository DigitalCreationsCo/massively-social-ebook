import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/routes';
import { generateGuestName } from '@/lib/utils';
import { useToast } from './use-toast';
import { getObfuscatedChannelId } from '@shared/channels';

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
  timeToNextDecision: number;
  turnsToNextChoice: number;
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

export function useLiveState(channelId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Ensure channelId is never undefined or empty
  if (!channelId) {
    console.warn('[LiveState] Undefined channelId provided, defaulting to x7v9z');
    channelId = 'x7v9z';
  }
  const obfId = channelId; // The input is now expected to be obfuscated ID from the selector

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
  const [ localTimeToDecision, setLocalTimeToDecision ] = useState(0);
  const [ localTurnsToNextChoice, setLocalTurnsToNextChoice ] = useState(0);
  const [voteResults, setVoteResults] = useState<VoteResults>({ A: 0, B: 0 });
  const [viewerCount, setViewerCount] = useState(() => 1247 + Math.floor(Math.random() * 500));

  // Fetch initial REST state
  const { data: currentBlock, isLoading: blockLoading } = useQuery({
    queryKey: [ api.blocks.current.path, obfId ],
    queryFn: async () => {
      const res = await fetch(`${api.blocks.current.path}?channelId=${obfId}`);
      if (!res.ok) throw new Error('Failed to fetch current block');
      return res.json() as Promise<StoryState>;
    },
  });

  const { data: chatHistory = [], isLoading: chatLoading } = useQuery({
    queryKey: [ api.chat.history.path, obfId ],
    queryFn: async () => {
      const res = await fetch(`${api.chat.history.path}?channelId=${obfId}`);
      if (!res.ok) throw new Error('Failed to fetch chat history');
      return res.json() as Promise<ChatMsg[]>;
    },
  });

  // Sync local timers with server state
  useEffect(() => {
    if (currentBlock?.timeRemaining !== undefined) {
      setLocalTimeRemaining(Math.floor(currentBlock.timeRemaining / 1000));
    }
    if (currentBlock?.timeToNextDecision !== undefined) {
      setLocalTimeToDecision(Math.floor(currentBlock.timeToNextDecision / 1000));
    }
  }, [ currentBlock?.timeRemaining, currentBlock?.timeToNextDecision, currentBlock?.phase, currentBlock?.id ]);

  // Local countdown interval for both timers
  useEffect(() => {
    if (localTimeRemaining <= 0 && localTimeToDecision <= 0) return;
    
    const interval = setInterval(() => {
      setLocalTimeRemaining(prev => Math.max(0, prev - 1));
      setLocalTimeToDecision(prev => Math.max(0, prev - 1));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [ localTimeRemaining, localTimeToDecision ]);

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
    const wsUrl = `${protocol}//${window.location.host}/ws?channelId=${obfId}`;
    
    const connect = () => {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsConnected(true);
        console.log('[LiveState] Connected to channel:', obfId);
      };

      socket.onclose = () => {
        setWsConnected(false);
        setTimeout(connect, 3000);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'SYNC_STATE') {
            const payload = message.payload as StoryState;
            queryClient.setQueryData([ api.blocks.current.path, obfId ], payload);
            setLocalTurnsToNextChoice(payload.turnsToNextChoice);
            if (payload.timeToNextDecision !== undefined) {
              setLocalTimeToDecision(Math.floor(payload.timeToNextDecision / 1000));
            }
          } 
          else if (message.type === 'CHAT_MESSAGE') {
            const payload = message.payload as ChatMsg;
            queryClient.setQueryData<ChatMsg[]>([ api.chat.history.path, obfId ], (old = []) => {
              if (old.some(m => m.id === payload.id)) return old;
              return [...old, payload];
            });
          }
          else if (message.type === 'VOTE_UPDATE') {
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
  }, [ queryClient, obfId ]);

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
    queryClient.setQueryData<ChatMsg[]>([ api.chat.history.path, obfId ], (old = []) => [ ...old, tempMsg ]);

    wsRef.current.send(JSON.stringify({
      type: 'SUBMIT_CHAT',
      payload: { username, text }
    }));
  }, [ username, queryClient, toast, obfId ]);

  const submitVote = useCallback((choice: 'A' | 'B') => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast({ title: "Vote failed", description: "You are offline.", variant: "destructive" });
      return;
    }
    
    sessionStorage.setItem(`voted_${obfId}_${currentBlock?.id}`, choice);
    
    wsRef.current.send(JSON.stringify({
      type: 'SUBMIT_VOTE',
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
  }, [ currentBlock?.id, currentBlock?.optionA, currentBlock?.optionB, toast, username, obfId ]);

  const hasVotedCurrent = sessionStorage.getItem(`voted_${obfId}_${currentBlock?.id}`) !== null;

  // Get most recent chat message
  const mostRecentMessage = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;

  return {
    isLoading: blockLoading || chatLoading,
    wsConnected,
    username,
    currentBlock,
    localTimeRemaining,
    localTimeToDecision,
    localTurnsToNextChoice,
    chatHistory,
    hasVotedCurrent,
    submitChat,
    submitVote,
    voteResults,
    viewerCount,
    mostRecentMessage
  };
}
