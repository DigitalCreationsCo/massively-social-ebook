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
import { useTts } from "./use-tts";

export { ChatMessage };

const START_BEFORE_MS = 3 * 60 * 1000;

export interface StoryState {
  id: number;
  channelId: string;
  title: string | null;
  content: string;
  dialogue: string;
  ttsEnabled: boolean;
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
    if (username) {
      identifyUser(username);
    }
  }, [username]);

  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  // Tracks clientId → optimistic message id so we can replace the optimistic
  // placeholder with the server-confirmed message when CHAT_MESSAGE arrives.
  const pendingClientIds = useRef(new Map<string, number>());

  const [sessionStatus, setSessionStatus] = useState<SessionStatus | "loading">(
    "scheduled",
  );
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [macroPhase, setMacroPhase] = useState<MacroPhase>("waiting");
  const [reactions, setReactions] = useState<Reaction[]>([]);

  const [viewerCount, setViewerCount] = useState(
    () => 1247 + Math.floor(Math.random() * 500),
  );

  const tts = useTts();
  const ambientGenerated = useRef(false);
  const ambientRetryCount = useRef(0);
  const ambientRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ambientRetryTick, setAmbientRetryTick] = useState(0);
  const lastBlockId = useRef<number | null>(null);

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

  // Fetch all blocks for the active session
  const { data: allBlocks = [], isLoading: blocksLoading } = useQuery({
    queryKey: [api.blocks.current.path, channelId, "all"],
    queryFn: async () => {
      const sessionId = activeSession?.id;
      if (!sessionId) return [];
      const res = await fetch(`/api/blocks/session/${sessionId}`);
      if (res.status === 404) return [];
      if (!res.ok) throw new Error("Failed to fetch blocks");
      return res.json() as Promise<StoryState[]>;
    },
    enabled: !!activeSession?.id,
    staleTime: 5000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  // Track which block index we're on
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const currentBlock = allBlocks[currentBlockIndex] ?? null;

  // Auto-advance: move to next block every READING_SEGMENT_MS (25s)
  // Allow manual skip after 11s
  useEffect(() => {
    if (allBlocks.length === 0) return;
    if (currentBlockIndex >= allBlocks.length - 1) return;

    const SKIP_AFTER_MS = 11_000;
    const ADVANCE_MS = 25_000;
    let skipped = false;

    const skipTimer = setTimeout(() => {
      skipped = true;
    }, SKIP_AFTER_MS);

    const advanceTimer = setInterval(() => {
      if (skipped) {
        // If enough time has passed to skip, advance now
      }
      setCurrentBlockIndex((prev) => {
        if (prev >= allBlocks.length - 1) return prev;
        return prev + 1;
      });
      clearInterval(advanceTimer);
    }, ADVANCE_MS);

    return () => {
      clearTimeout(skipTimer);
      clearInterval(advanceTimer);
    };
  }, [currentBlockIndex, allBlocks.length]);

  // Allow manual advance to next block
  const advanceToNextBlock = useCallback(() => {
    setCurrentBlockIndex((prev) => {
      if (prev >= allBlocks.length - 1) return prev;
      return prev + 1;
    });
  }, [allBlocks.length]);

  // Fetch initial REST state
  const { data: currentBlockData, isLoading: blockLoading } = useQuery({
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
    staleTime: Infinity,
  });

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

              queryClient.setQueryData<StoryState>(
                [api.blocks.current.path, channelId],
                payload,
              );

            } else if (message.type === "CHAT_MESSAGE") {
              const payload = message.payload as ChatMessage & {
                clientId?: string;
              };
              queryClient.setQueryData<ChatMessage[]>(
                [api.chat.history.path, channelId],
                (old = []) => {
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
                  if (old.some((m) => m.id === payload.id)) return old;
                  return [...old, payload];
                },
              );
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

  // Refine the Macro Phase calculation
  useEffect(() => {
    if (!activeSession) {
      setMacroPhase("waiting");
      return;
    }

    const updatePhase = () => {
      const now = Date.now();
      const start = new Date(activeSession.scheduledStart).getTime();
      const end = new Date(activeSession.scheduledEnd).getTime();

      if (now > end || currentBlock?.phase === "resolution") {
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
        username,
        text,
        createdAt: new Date(),
      };

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
    [username, queryClient, toast, channelId, currentBlock?.id, activeSession?.id],
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

      setReactions((prev) => [
        ...prev,
        {
          id: Date.now(),
          channelId: channelId,
          sessionId: activeSession?.id || 0,
          blockId,
          userId: username,
          emoji,
          paragraphIndex: paragraphIndex ?? null,
          createdAt: new Date(),
        },
      ]);
    },
    [username, channelId, activeSession],
  );

  const isSessionLive = useMemo(
    () => shouldShowLiveSession(sessionStatus, activeSession),
    [sessionStatus, activeSession],
  );

  // Get most recent chat message
  const mostRecentMessage =
    (chatHistory ?? []).length > 0 ? chatHistory[chatHistory.length - 1] : null;

  // ── Auto-ambient: generate from session.description wrapped in [] ─────
  useEffect(() => {
    let cancelled = false;

    const isValidPhase =
      macroPhase === "reading" || macroPhase === "gathering";

    if (!isValidPhase || !activeSession?.description) {
      ambientGenerated.current = false;
      ambientRetryCount.current = 0;
      return;
    }

    if (!ambientGenerated.current && !ambientRetryTimer.current) {
      (async () => {
        const success = await tts.generateAndPlay(
          `[${activeSession.description}]`,
          "ambient",
          { sessionId: activeSession.id },
        );
        if (cancelled) return;
        if (success) {
          ambientGenerated.current = true;
          ambientRetryCount.current = 0;
        } else {
          ambientRetryCount.current += 1;
          if (ambientRetryCount.current <= 5) {
            const delay = Math.min(
              1000 * 2 ** (ambientRetryCount.current - 1),
              30000,
            );
            ambientRetryTimer.current = setTimeout(() => {
              ambientRetryTimer.current = null;
              if (!cancelled) setAmbientRetryTick((t) => t + 1);
            }, delay);
          }
        }
      })();
    }

    return () => {
      cancelled = true;
      if (ambientRetryTimer.current) {
        clearTimeout(ambientRetryTimer.current);
        ambientRetryTimer.current = null;
      }
    };
  }, [macroPhase, activeSession?.description, ambientRetryTick, activeSession?.id]);

  // ── Auto-dialogue: generate from block.dialogue || block.content ───────
  useEffect(() => {
    if (currentBlock?.id && currentBlock.id !== lastBlockId.current) {
      lastBlockId.current = currentBlock.id;
      const dialogueText = currentBlock.dialogue || currentBlock.content;
      if (dialogueText && currentBlock.ttsEnabled !== false) {
        tts.stopDialogue();
        tts.generateAndPlay(dialogueText, "dialogue", {
          blockId: currentBlock.id,
        });
      }
    }
  }, [currentBlock?.id, currentBlock?.dialogue, currentBlock?.content, currentBlock?.ttsEnabled]);

  return {
    isLoading: blocksLoading || chatLoading || sessionLoading,
    wsConnected,
    username,
    currentBlock: currentBlock ?? currentBlockData,
    allBlocks,
    currentBlockIndex,
    advanceToNextBlock,
    chatHistory,
    submitChat,
    submitReaction,
    reactions,
    viewerCount,
    mostRecentMessage,
    sessionStatus,
    activeSession,
    activeChannel,
    isSessionLive,
    macroPhase,
    ttsIsSpeaking: tts.isSpeaking,
    ttsIsPending: tts.isPending,
    ttsError: tts.error,
    ttsToggle: tts.toggle,
    ttsStopDialogue: tts.stopDialogue,
  };
}
