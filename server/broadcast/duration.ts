// Single source for broadcast image duration floors.
// Previously duplicated in coordinator.ts and media-slots.ts with ceil drift.
// Ponytail: one helper, env parsed once per call, clamp 1..30.

export function broadcastImageFloor(): number {
  const configured = Number(process.env.BROADCAST_IMAGE_DURATION_SECONDS ?? 12);
  return Number.isFinite(configured) ? Math.max(1, Math.min(30, configured)) : 12;
}

export function imageOnlyDuration(): number {
  const configured = Number(process.env.BROADCAST_IMAGE_ONLY_DURATION_SECONDS ?? 15);
  return Number.isFinite(configured) ? Math.max(1, Math.min(30, configured)) : 15;
}

export function slotDurationForSpeech(speechDurationSeconds?: number): number {
  if (speechDurationSeconds === undefined) return imageOnlyDuration();
  const floor = broadcastImageFloor();
  if (!Number.isFinite(speechDurationSeconds)) return floor;
  return Math.max(floor, speechDurationSeconds);
}

export function safeImageDuration(durationSeconds: number): number {
  const floor = broadcastImageFloor();
  if (!Number.isFinite(durationSeconds)) return floor;
  const clamped = Math.max(1, Math.min(30, Math.ceil(Math.max(floor, durationSeconds))));
  return clamped;
}
