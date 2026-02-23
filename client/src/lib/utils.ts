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
