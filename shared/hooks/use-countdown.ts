import { useState, useEffect } from "react";
import { countdownAt } from "@portalshq/runtime-core";

/**
 * Returns a formatted countdown string ("HH:MM:SS") and a
 * boolean indicating whether the target has been reached.
 *
 * When the target is past (or null/undefined) the string is empty
 * and `isStarting` is false — the caller decides what to render.
 *
 * Time math is delegated to the shared portals helper so the client
 * and the server observe deadlines the same way.
 */
export function useCountdown(
  targetDate: string | Date | null | undefined,
): { timeLeft: string; isStarting: boolean } {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!targetDate) {
      setTimeLeft("");
      return;
    }

    const target = new Date(targetDate);

    const updateTimer = () => {
      const snapshot = countdownAt(new Date(), target);
      if (snapshot.expired || snapshot.remainingMs <= 0) {
        setTimeLeft("Starting...");
        return;
      }

      const diff = snapshot.remainingMs;

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft(
        `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`,
      );
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return {
    timeLeft,
    isStarting: timeLeft === "Starting...",
  };
}
