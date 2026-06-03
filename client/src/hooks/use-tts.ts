import { useState, useRef, useCallback, useEffect } from "react";
import { textToSpeech } from "@/lib/tts";
import { audioManager } from "@/lib/audio-manager";
import { fetchAndDecode } from "@/lib/audio-analyzer";

export function useTts() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);
  const generatingRef = useRef(false);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const generateAndPlay = useCallback(
    async (text: string, type: "ambient" | "dialogue"): Promise<void> => {
      if (!text || generatingRef.current) return;

      generatingRef.current = true;
      setIsPending(true);
      setError(null);

      const audioUrl = await textToSpeech(text);

      if (!isMounted.current) {
        generatingRef.current = false;
        return;
      }

      if (!audioUrl) {
        setIsPending(false);
        setError("Failed to generate speech");
        generatingRef.current = false;
        return;
      }

      const ctx = audioManager.getContext();
      const buffer = await fetchAndDecode(ctx, audioUrl);

      if (!isMounted.current) {
        generatingRef.current = false;
        return;
      }

      if (!buffer) {
        setIsPending(false);
        setError("Generated audio failed validation");
        generatingRef.current = false;
        return;
      }

      setIsPending(false);
      setIsSpeaking(true);
      audioManager.play(buffer, type);
      generatingRef.current = false;
    },
    [],
  );

  const stopAll = useCallback(() => {
    audioManager.stopAll();
    setIsSpeaking(false);
    setIsPending(false);
    generatingRef.current = false;
  }, []);

  const stopDialogue = useCallback(() => {
    audioManager.stopDialogue();
    generatingRef.current = false;
    if (!audioManager.isPlaying()) {
      setIsSpeaking(false);
    }
  }, []);

  const speak = useCallback(
    (text: string) => generateAndPlay(text, "dialogue"),
    [generateAndPlay],
  );

  const toggle = useCallback(
    (text: string) => {
      if (audioManager.isPlaying()) {
        stopDialogue();
      } else {
        speak(text);
      }
    },
    [speak, stopDialogue],
  );

  useEffect(() => {
    const interval = setInterval(() => {
      if (isMounted.current) {
        setIsSpeaking(audioManager.isPlaying());
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      audioManager.stopAll();
    };
  }, []);

  return {
    speak,
    stopAll,
    stopDialogue,
    toggle,
    generateAndPlay,
    isSpeaking,
    isPending,
    error,
  };
}
