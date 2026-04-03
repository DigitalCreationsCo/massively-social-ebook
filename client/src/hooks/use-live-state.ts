import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/routes';
import { generateGuestName } from '@/lib/utils';
import { useToast } from './use-toast';
import type { Session, Reaction, Phase, MacroPhase, SessionStatus, ChatMessage } from '@shared/schema';
import { trackEvent, identifyUser } from '@/lib/analytics';

export interface StoryState {
  id: number;
  channelId: string;
  title: string | null;
  content: string;
  imageUrl: string | null;
  optionA: VoteOption | null | undefined;
  optionB: VoteOption | null | undefined;
  createdAt: string;
  phase: Phase;
  timeRemaining: number;
  timeToNextDecision: number;
  initialTimeToNextDecision: number;
  turnsToNextChoice: number;
}

export interface VoteOption {
  label: string;
  description: string;
}

export interface VoteResults {
  A: number;
  B: number;
}

export function useLiveState(channelId: string) {
  if (!channelId) {
    throw new Error('useLiveState: channelId is required. No default channel.');
  }

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [username] = useState(() => {
    const stored = sessionStorage.getItem('reader_name');
    if (stored) return stored;
    const newName = generateGuestName();
    sessionStorage.setItem('reader_name', newName);
    return newName;
  });
  useEffect(() => {
    if (!username) {
      identifyUser(username);
    }
  }, [username]);


  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [localTimeRemaining, setLocalTimeRemaining] = useState(0);
  const [localTimeToDecision, setLocalTimeToDecision] = useState(0);
  const [localInitialTimeToDecision, setLocalInitialTimeToDecision] = useState(0);
  const [localTurnsToNextChoice, setLocalTurnsToNextChoice] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | 'loading'>('loading');
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [macroPhase, setMacroPhase] = useState<MacroPhase>('waiting');
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [voteResults, setVoteResults] = useState<VoteResults>({ A: 0, B: 0 });
  const [viewerCount, setViewerCount] = useState(() => 1247 + Math.floor(Math.random() * 500));

  const { data: initialSession, isLoading: sessionLoading } = useQuery({
    queryKey: [api.sessions.next.path, channelId],
    queryFn: async () => {
      const res = await fetch(`${api.sessions.next.path}?channelId=${channelId}`);
      if (!res.ok) return null;
      return res.json() as Promise<Session | null>;
    },
    staleTime: 5000,
  });

  useEffect(() => {
    if (initialSession && !wsConnected) {
      setSessionStatus(initialSession.status as SessionStatus);
      setActiveSession(initialSession);
    }
  }, [initialSession, wsConnected]);

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
      return res.json() as Promise<ChatMessage[]>;
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
    if (currentBlock?.initialTimeToNextDecision !== undefined) {
      setLocalInitialTimeToDecision(Math.floor(currentBlock.initialTimeToNextDecision / 1000));
    }
  }, [currentBlock?.timeRemaining, currentBlock?.timeToNextDecision, currentBlock?.initialTimeToNextDecision, currentBlock?.phase, currentBlock?.id]);

  // Local countdown interval for both timers
  useEffect(() => {
    if (localTimeRemaining <= 0 && localTimeToDecision <= 0) return;

    const interval = setInterval(() => {
      setLocalTimeRemaining(prev => Math.max(0, prev - 1));
      setLocalTimeToDecision(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [localTimeRemaining, localTimeToDecision]);

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

  // Calculate Macro Phase
  useEffect(() => {
    if (!activeSession) {
      setMacroPhase('waiting');
      return;
    }
    const updatePhase = () => {
      const now = Date.now();
      const start = new Date(activeSession.scheduledStart).getTime();
      const diff = now - start;

      if (currentBlock?.phase === 'resolution') {
        setMacroPhase('afterparty');
      } else if (diff < -3 * 60 * 1000) {
        setMacroPhase('waiting');
      } else if (diff < 0) {
        setMacroPhase('gathering'); // Before scheduled start
      } else {
        setMacroPhase('reading'); // Session is active
      }

    };

    updatePhase();
    const interval = setInterval(updatePhase, 1000);
    return () => clearInterval(interval);
  }, [activeSession, currentBlock?.phase]);

   // WebSocket Connection
   useEffect(() => {
     let wsUrl: string;
     if (import.meta.env.VITE_WS_URL) {
       wsUrl = `${import.meta.env.VITE_WS_URL}/ws?channelId=${channelId}`;
     } else {
       const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
       const host = window.location.hostname === 'localhost' 
         ? `localhost:5001` 
         : window.location.host;
       wsUrl = `${protocol}//${host}/ws?channelId=${channelId}`;
     }

     const connect = () => {
       const socket = new WebSocket(wsUrl);
       wsRef.current = socket;

       socket.onopen = () => {
         setWsConnected(true);
         console.log('[LiveState] Connected to channel:', channelId);
       };

       socket.onclose = () => {
         setWsConnected(false);
         setSessionStatus('loading');
         setTimeout(connect, 3000);
       };

       socket.onmessage = (event) => {
         try {
           const message = JSON.parse(event.data);

           if (message.type === 'SYNC_STATE') {

             const payload = message.payload as StoryState;

             setLocalTurnsToNextChoice(payload.turnsToNextChoice);
             if (payload.timeRemaining !== undefined) {
               setLocalTimeRemaining(Math.floor(payload.timeRemaining / 1000));
             }
             if (payload.timeToNextDecision !== undefined) {
               setLocalTimeToDecision(Math.floor(payload.timeToNextDecision / 1000));
             }
             if (payload.initialTimeToNextDecision !== undefined) {
               setLocalInitialTimeToDecision(Math.floor(payload.initialTimeToNextDecision / 1000));
             }
           }
           else if (message.type === 'CHAT_MESSAGE') {
             const payload = message.payload as ChatMessage;
             queryClient.setQueryData<ChatMessage[]>([api.chat.history.path, channelId], (old = []) => {
               if (old.some(m => m.id === payload.id)) return old;
               return [...old, payload];
             });
           }
           else if (message.type === 'VOTE_UPDATE') {
             const payload = message.payload as VoteResults;
             setVoteResults(payload);
           }
           else if (message.type === 'REACTION_RECEIVED') {
             const payload = message.payload as Reaction;
             setReactions(prev => [...prev, payload]);
           }
           else if (message.type === 'SESSION_STATUS') {
             const payload = message.payload as { status: SessionStatus, session: Session | null; };

             const now = Date.now();
             const isPast = payload.session && new Date(payload.session.scheduledEnd).getTime() < now;

             if (isPast) {
               // If the server sends a session that is technically over, treat it as completed
               setSessionStatus('completed');
               setActiveSession(null);
             } else {
               setSessionStatus(payload.status);
               setActiveSession(payload.session);
               if (payload.status === 'active') {
                 queryClient.invalidateQueries({ queryKey: [api.blocks.current.path, channelId] });
               }
             }
           }
         } catch (err) {
           console.error('[LiveState] Failed to parse WS message:', err);
         };
       };
     };
     connect();

     return () => {
       wsRef.current?.close();
     };
   }, [queryClient, channelId]);

  // Refine the Macro Phase calculation to be more robust
  useEffect(() => {
    if (!activeSession) {
      setMacroPhase('waiting');
      return;
    }

    const updatePhase = () => {
      const now = Date.now();
      const start = new Date(activeSession.scheduledStart).getTime();
      const end = new Date(activeSession.scheduledEnd).getTime();

      if (now > end || currentBlock?.phase === 'resolution') {
        setMacroPhase('afterparty');
      } else if (now < start - 3 * 60 * 1000) {
        setMacroPhase('waiting');
      } else if (now < start) {
        setMacroPhase('gathering');
      } else {
        setMacroPhase('reading');
      }
    };

    updatePhase();
    const interval = setInterval(updatePhase, 1000);
    return () => clearInterval(interval);
  }, [activeSession, currentBlock?.phase]);

  const submitChat = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast({ title: "Connection lost", description: "Trying to reconnect...", variant: "destructive" });
      return;
    }

    const tempMsg: ChatMessage = {
      id: Date.now(),
      channelId,
      sessionId: activeSession?.id || null,
      username,
      text,
      createdAt: new Date()
    };
    queryClient.setQueryData<ChatMessage[]>([api.chat.history.path, channelId], (old = []) => [...old, tempMsg]);

    trackEvent('Chat Message Sent', { channel: channelId });

    wsRef.current.send(JSON.stringify({
      type: 'SUBMIT_CHAT',
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
  }, [currentBlock?.id, currentBlock?.optionA, currentBlock?.optionB, toast, username, channelId]);

  const submitReaction = useCallback((blockId: number, emoji: string, paragraphIndex: number) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    trackEvent('Reaction Sent', { channel: channelId, emoji, blockId });

    wsRef.current.send(JSON.stringify({
      type: 'SUBMIT_REACTION',
      payload: { blockId, emoji, userId: username, paragraphIndex }
    }));

    // Optimistic update
    setReactions(prev => [...prev, {
      id: Date.now(), // Temporary ID
      channelId: channelId,
      sessionId: activeSession?.id || 0,
      blockId,
      userId: username,
      emoji,
      paragraphIndex,
      createdAt: new Date()
    }]);
  }, [username, channelId, activeSession]);

  const hasVotedCurrent = sessionStorage.getItem(`voted_${channelId}_${currentBlock?.id}`) !== null;

  // Get most recent chat message
  const mostRecentMessage = (chatHistory ?? []).length > 0 ? chatHistory[chatHistory.length - 1] : null;

  // Reset vote results when the story block changes
  useEffect(() => {
    setVoteResults({ A: 0, B: 0 });
  }, [currentBlock?.id]);

  return {
    isLoading: blockLoading || chatLoading || sessionLoading,
    wsConnected,
    username,
    currentBlock,
    localTimeRemaining,
    localTimeToDecision,
    localInitialTimeToDecision,
    localTurnsToNextChoice,
    chatHistory,
    hasVotedCurrent,
    submitChat,
    submitVote,
    submitReaction,
    voteResults,
    reactions,
    viewerCount,
    mostRecentMessage,
    sessionStatus,
    activeSession,
    macroPhase
  };
}
