import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { shouldShowLiveSession } from "@shared/session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { generateGuestName } from "@/lib/utils";
import { useToast } from "./use-toast";
import type {
  Session,
  Channel,
  Reaction,
  Phase,
  MacroPhase,
  SessionStatus,
  ChatMessage,
} from "@shared/schema";
import { trackEvent, identifyUser } from "@/lib/analytics";

export { ChatMessage };

const START_BEFORE_MS = 3 * 60 * 1000;

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
  phaseInitialMs?: number;
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
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [username] = useState(() => {
    const stored = sessionStorage.getItem("reader_name");
    if (stored) return stored;
    const newName = generateGuestName();
    sessionStorage.setItem("reader_name", newName);
    return newName;
  });
  useEffect(() => {
    if (!username) {
      identifyUser(username);
    }
  }, [username]);

  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  // Tracks clientId → optimistic message id so we can replace the optimistic
  // placeholder with the server-confirmed message when CHAT_MESSAGE arrives.
  const pendingClientIds = useRef(new Map<string, number>());
  const [localTimeRemaining, setLocalTimeRemaining] = useState(0);
  const [localTimeToDecision, setLocalTimeToDecision] = useState(0);
  const [localInitialTimeToDecision, setLocalInitialTimeToDecision] =
    useState(0);
  const [localInitialTimeRemaining, setLocalInitialTimeRemaining] = useState(0);
  const [localTurnsToNextChoice, setLocalTurnsToNextChoice] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | "loading">(
    "scheduled",
  );
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [macroPhase, setMacroPhase] = useState<MacroPhase>("waiting");
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [voteResults, setVoteResults] = useState<VoteResults>({ A: 0, B: 0 });
  const [viewerCount, setViewerCount] = useState(
    () => 1247 + Math.floor(Math.random() * 500),
  );

  const { data: initialData, isLoading: sessionLoading } = useQuery({
    queryKey: [api.sessions.next.path, channelId],
    queryFn: async () => {
      const res = await fetch(
        `${api.sessions.next.path}?channelId=${channelId}`,
      );
      if (!res.ok) return null;
      return res.json() as Promise<{
        session: Session | null;
        channel: Channel;
      } | null>;
    },
    staleTime: 5000,
  });
  const initialSession = initialData?.session ?? null;
  const initialChannel = initialData?.channel ?? null;

  useEffect(() => {
    if (sessionLoading) return;
    if (!initialSession) {
      if (!wsConnected) {
        setActiveSession(null);
        setActiveChannel(initialChannel);
        setSessionStatus("scheduled");
      }
      return;
    }
    const isPast = new Date(initialSession.scheduledEnd).getTime() < Date.now();
    if (isPast && initialSession.status === "active") {
      setSessionStatus("completed");
      setActiveSession(null);
      setActiveChannel(initialChannel);
      return;
    }
    if (!isPast) {
      setSessionStatus(initialSession.status as SessionStatus);
      setActiveSession(initialSession);
      setActiveChannel(initialChannel);
    }
  }, [initialSession, initialChannel, sessionLoading, wsConnected]);

  // Fetch initial REST state
  const { data: currentBlock, isLoading: blockLoading } = useQuery({
    queryKey: [api.blocks.current.path, channelId],
    queryFn: async () => {
      const res = await fetch(
        `${api.blocks.current.path}?channelId=${channelId}`,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch current block");
      return res.json() as Promise<StoryState>;
    },
    retry: false,
    staleTime: Infinity,
    // Poll every 30s as a safety net for missed WebSocket messages. The WS
    // SYNC_STATE/SESSION_STATUS handlers are the primary update path; this
    // ensures the client eventually recovers if WS messages are dropped or
    // the connection is interrupted during a critical transition.
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const { data: chatHistory = [], isLoading: chatLoading } = useQuery({
    queryKey: [api.chat.history.path, channelId],
    queryFn: async () => {
      const res = await fetch(
        `${api.chat.history.path}?channelId=${channelId}`,
      );
      if (!res.ok) throw new Error("Failed to fetch chat history");
      return res.json() as Promise<ChatMessage[]>;
    },
    // WebSocket CHAT_MESSAGE handler calls setQueryData on this key for every
    // incoming message, so background refetches would just duplicate work.
    staleTime: Infinity,
  });

  // Sync local timers with server state
  useEffect(() => {
    if (currentBlock?.timeRemaining !== undefined) {
      setLocalTimeRemaining(Math.floor(currentBlock.timeRemaining / 1000));
    }
    if (currentBlock?.timeToNextDecision !== undefined) {
      setLocalTimeToDecision(
        Math.floor(currentBlock.timeToNextDecision / 1000),
      );
    }
    if (currentBlock?.initialTimeToNextDecision !== undefined) {
      setLocalInitialTimeToDecision(
        Math.floor(currentBlock.initialTimeToNextDecision / 1000),
      );
    }
    if (currentBlock?.phaseInitialMs !== undefined) {
      setLocalInitialTimeRemaining(
        Math.floor(currentBlock.phaseInitialMs / 1000),
      );
    }
  }, [
    currentBlock?.timeRemaining,
    currentBlock?.timeToNextDecision,
    currentBlock?.initialTimeToNextDecision,
    currentBlock?.phaseInitialMs,
    currentBlock?.phase,
    currentBlock?.id,
  ]);

  // Simulate viewer count fluctuations
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     setViewerCount((prev) => {
  //       const change = Math.floor(Math.random() * 21) - 10;
  //       return Math.max(100, prev + change);
  //     });
  //   }, 5000);
  //   return () => clearInterval(interval);
  // }, []);

  // WebSocket Connection
  useEffect(() => {
    if (!channelId || channelId.trim() === "") {
      console.warn(
        "[LiveState] Skipping WebSocket connection — channelId is empty",
      );
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const BASE_RECONNECT_DELAY = 1000;
    const MAX_RECONNECT_DELAY = 30000;

    let wsUrl: string;
    if (import.meta.env.VITE_WS_URL) {
      wsUrl = `${import.meta.env.VITE_WS_URL}/ws?channelId=${encodeURIComponent(channelId)}`;
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host || "localhost:5001";
      wsUrl = `${protocol}//${host}/ws?channelId=${encodeURIComponent(channelId)}`;
    }

    const scheduleReconnect = () => {
      if (cancelled) return;
      reconnectAttempts++;
      const delay = Math.min(
        BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1),
        MAX_RECONNECT_DELAY,
      );
      const jitter = Math.random() * 1000;
      console.log(
        `[LiveState] Reconnecting in ${Math.round(delay + jitter)}ms (attempt ${reconnectAttempts})`,
      );
      reconnectTimer = setTimeout(connect, delay + jitter);
    };

    const connect = () => {
      if (cancelled) return;

      try {
        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onopen = () => {
          if (cancelled) {
            socket.close();
            return;
          }
          reconnectAttempts = 0;
          setWsConnected(true);
          console.log("[LiveState] Connected to channel:", channelId);
        };

        socket.onclose = (event) => {
          if (cancelled) return;
          setWsConnected(false);
          console.warn(
            "[LiveState] WebSocket closed:",
            event.code,
            event.reason,
          );
          scheduleReconnect();
        };

        socket.onerror = (error) => {
          if (cancelled) return;
          console.error("[LiveState] WebSocket error:", error);
        };

        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            if (message.type === "SYNC_STATE") {
              const payload = message.payload as StoryState;

              // Update the cached block data so the UI shows the correct
              // story content, phase, voting options, etc.  The REST query
              // has staleTime: Infinity so it never refetches — the WS is
              // the sole update path after initial page load.
              queryClient.setQueryData<StoryState>(
                [api.blocks.current.path, channelId],
                payload,
              );

              setLocalTurnsToNextChoice(payload.turnsToNextChoice);
              if (payload.timeRemaining !== undefined) {
                setLocalTimeRemaining(Math.floor(payload.timeRemaining / 1000));
              }
              if (payload.timeToNextDecision !== undefined) {
                setLocalTimeToDecision(
                  Math.floor(payload.timeToNextDecision / 1000),
                );
              }
              if (payload.initialTimeToNextDecision !== undefined) {
                setLocalInitialTimeToDecision(
                  Math.floor(payload.initialTimeToNextDecision / 1000),
                );
              }
              if (payload.phaseInitialMs !== undefined) {
                setLocalInitialTimeRemaining(
                  Math.floor(payload.phaseInitialMs / 1000),
                );
              }
            } else if (message.type === "CHAT_MESSAGE") {
              const payload = message.payload as ChatMessage & {
                clientId?: string;
              };
              queryClient.setQueryData<ChatMessage[]>(
                [api.chat.history.path, channelId],
                (old = []) => {
                  // If this message has a clientId we're tracking, replace the
                  // optimistic placeholder with the server-confirmed message.
                  if (
                    payload.clientId &&
                    pendingClientIds.current.has(payload.clientId)
                  ) {
                    const optimisticId = pendingClientIds.current.get(
                      payload.clientId,
                    )!;
                    pendingClientIds.current.delete(payload.clientId);
                    return old.map((m) =>
                      m.id === optimisticId ? payload : m,
                    );
                  }
                  // For messages from other clients (no clientId), guard
                  // against any accidental duplicates by server id.
                  if (old.some((m) => m.id === payload.id)) return old;
                  return [...old, payload];
                },
              );
            } else if (message.type === "VOTE_UPDATE") {
              const payload = message.payload as VoteResults;
              setVoteResults(payload);
            } else if (message.type === "REACTION_RECEIVED") {
              const payload = message.payload as Reaction;
              setReactions((prev) => [...prev, payload]);
            } else if (message.type === "SESSION_STATUS") {
              const payload = message.payload as {
                status: SessionStatus;
                session: Session | null;
              };
              const now = Date.now();
              const isPast =
                payload.session &&
                new Date(payload.session.scheduledEnd).getTime() < now;

              if (isPast && payload.status === "active") {
                setSessionStatus("completed");
                setActiveSession(null);
                void queryClient.invalidateQueries({
                  queryKey: [api.sessions.next.path, channelId],
                });
              } else if (payload.session) {
                setSessionStatus(payload.status);
                setActiveSession(payload.session);
                if (payload.status === "active") {
                  queryClient.invalidateQueries({
                    queryKey: [api.blocks.current.path, channelId],
                  });
                  queryClient.invalidateQueries({
                    queryKey: [api.sessions.next.path, channelId],
                  });
                }
              } else {
                setSessionStatus(payload.status);
                void queryClient.invalidateQueries({
                  queryKey: [api.sessions.next.path, channelId],
                });
              }
            }
          } catch (err) {
            console.error("[LiveState] Failed to parse WS message:", err);
          }
        };
      } catch (err) {
        console.error("[LiveState] Failed to create WebSocket:", err);
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [queryClient, channelId]);

  // Refine the Macro Phase calculation to be more robust
  //
  // The server now explicitly tracks afterparty as a phase (broadcast via
  // SYNC_STATE), so we check currentBlock.phase first.  The lobby/gathering
  // window is still computed client-side from scheduledStart timestamps.
  useEffect(() => {
    if (!activeSession) {
      setMacroPhase("waiting");
      return;
    }

    const updatePhase = () => {
      const now = Date.now();
      const start = new Date(activeSession.scheduledStart).getTime();
      const end = new Date(activeSession.scheduledEnd).getTime();

      // Server tells us when we're in afterparty — this is authoritative
      // and covers the ~3-minute window after resolution ends.
      if (currentBlock?.phase === "afterparty") {
        setMacroPhase("afterparty");
      } else if (now > end || currentBlock?.phase === "resolution") {
        // Resolution phase = reading concluding, chat opens up
        setMacroPhase("afterparty");
      } else if (now < start - START_BEFORE_MS) {
        setMacroPhase("waiting");
      } else if (now < start) {
        setMacroPhase("gathering");
      } else {
        setMacroPhase("reading");
      }
    };

    updatePhase();
    const interval = setInterval(updatePhase, 1000);
    return () => clearInterval(interval);
  }, [activeSession, currentBlock?.phase]);

  const submitChat = useCallback(
    (text: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        toast({
          title: "Connection lost",
          description: "Trying to reconnect...",
          variant: "destructive",
        });
        return;
      }

      const clientId = crypto.randomUUID();
      const optimisticId = Date.now();

      const tempMsg: ChatMessage = {
        id: optimisticId,
        channelId,
        sessionId: activeSession?.id || null,
        blockId: currentBlock?.id || null,
        userId: username,
        username,
        text,
        createdAt: new Date(),
      };

      // Track this optimistic message so we can replace it when the server
      // broadcasts back the confirmed message (instead of appending a duplicate).
      pendingClientIds.current.set(clientId, optimisticId);

      queryClient.setQueryData<ChatMessage[]>(
        [api.chat.history.path, channelId],
        (old = []) => [...old, tempMsg],
      );

      trackEvent("Chat Message Sent", { channel: channelId });

      wsRef.current.send(
        JSON.stringify({
          type: "SUBMIT_CHAT",
          payload: { username, text, clientId },
        }),
      );
    },
    [username, queryClient, toast, channelId],
  );

  const submitVote = useCallback(
    (choice: "A" | "B") => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        toast({
          title: "Vote failed",
          description: "You are offline.",
          variant: "destructive",
        });
        return;
      }

      sessionStorage.setItem(`voted_${channelId}_${currentBlock?.id}`, choice);

      wsRef.current.send(
        JSON.stringify({
          type: "SUBMIT_VOTE",
          payload: { choice, userId: username },
        }),
      );

      // Update local vote results optimistically
      setVoteResults((prev) => ({
        ...prev,
        [choice]: prev[choice] + 1,
      }));

      toast({
        title: "Vote cast!",
        description: `You chose ${currentBlock?.optionA && choice === "A" ? currentBlock.optionA.label : currentBlock?.optionB?.label}.`,
        duration: 2000,
      });
    },
    [
      currentBlock?.id,
      currentBlock?.optionA,
      currentBlock?.optionB,
      toast,
      username,
      channelId,
    ],
  );

  const submitReaction = useCallback(
    (blockId: number, emoji: string, paragraphIndex?: number) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      trackEvent("Reaction Sent", { channel: channelId, emoji, blockId });

      wsRef.current.send(
        JSON.stringify({
          type: "SUBMIT_REACTION",
          payload: { blockId, emoji, userId: username, paragraphIndex },
        }),
      );

      // Optimistic update
      setReactions((prev) => [
        ...prev,
        {
          id: Date.now(), // Temporary ID
          channelId: channelId,
          sessionId: activeSession?.id || 0,
          blockId,
          userId: username,
          emoji,
          paragraphIndex,
          createdAt: new Date(),
        },
      ]);
    },
    [username, channelId, activeSession],
  );

  const hasVotedCurrent =
    sessionStorage.getItem(`voted_${channelId}_${currentBlock?.id}`) !== null;

  const isSessionLive = useMemo(
    () => shouldShowLiveSession(sessionStatus, activeSession),
    [sessionStatus, activeSession],
  );

  // Get most recent chat message
  const mostRecentMessage =
    (chatHistory ?? []).length > 0 ? chatHistory[chatHistory.length - 1] : null;

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
    localInitialTimeRemaining,
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
    activeChannel,
    isSessionLive,
    macroPhase,
  };
}
