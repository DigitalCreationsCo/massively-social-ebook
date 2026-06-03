export interface AudioAnalysis {
  valid: boolean;
  rms: number;
  peak: number;
  durationMs: number;
  reason?: string;
}

const MIN_DURATION_MS = 800;
const MAX_DURATION_MS = 120_000;
const RMS_FLOOR = 0.005;
const CLIP_SAMPLE = 0.995;
const MAX_CLIP_FRACTION = 0.02;

export function analyzeBuffer(buffer: AudioBuffer): AudioAnalysis {
  const durationMs = buffer.duration * 1000;
  const channels = buffer.numberOfChannels;
  const length = buffer.length;

  let sumSq = 0;
  let peak = 0;
  let clipped = 0;
  let total = 0;

  for (let ch = 0; ch < channels; ch++) {
    const samples = buffer.getChannelData(ch);
    total += samples.length;
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      sumSq += abs * abs;
      if (abs > peak) peak = abs;
      if (abs >= CLIP_SAMPLE) clipped++;
    }
  }

  const rms = Math.sqrt(sumSq / total);
  const clipFraction = clipped / total;

  const issues: string[] = [];
  if (durationMs < MIN_DURATION_MS) issues.push("too short");
  if (durationMs > MAX_DURATION_MS) issues.push("too long");
  if (rms < RMS_FLOOR) issues.push("silent");
  if (clipFraction > MAX_CLIP_FRACTION) issues.push("clipped");

  return {
    valid: issues.length === 0,
    rms,
    peak,
    durationMs,
    reason: issues.length > 0 ? issues.join(", ") : undefined,
  };
}

export async function fetchAndDecode(
  ctx: AudioContext,
  url: string,
): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[AudioAnalyzer] Fetch failed: ${res.status}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const analysis = analyzeBuffer(audioBuffer);
    if (!analysis.valid) {
      console.warn(`[AudioAnalyzer] Discarded bad audio: ${analysis.reason}`);
      return null;
    }

    return audioBuffer;
  } catch (err) {
    console.error("[AudioAnalyzer] Failed to decode audio:", err);
    return null;
  }
}
