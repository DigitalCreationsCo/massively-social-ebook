import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

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
 * server acknowledgement. `crypto.randomUUID` is not available in every
 * supported browser or insecure local preview, so use random bytes when it is
 * unavailable.
 */
export function generateClientUuid(): string {
  const webCrypto = typeof crypto === "undefined" ? undefined : crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 version 4 and variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
