import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { generateUUID } from "@portalshq/capability-realtime-fanout";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Generate a random fun username for the session
export function generateGuestName() {
  const adjectives = ['Silent', 'Wandering', 'Curious', 'Lost', 'Eager', 'Hidden', 'Brave'];
  const nouns = ['Reader', 'Traveler', 'Scholar', 'Watcher', 'Seeker', 'Ghost', 'Echo'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${noun}_${num}`;
}

/**
 * Creates a UUID suitable for correlating an optimistic chat message with its
 * server acknowledgement. This is a thin wrapper around the shared portals
 * helper so the client and the server generate identifiers the same way.
 */
export function generateClientUuid(): string {
  return generateUUID();
}
