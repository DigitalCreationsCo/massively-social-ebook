import { generateUUID } from "@portalshq/capability-realtime-fanout";
import fs from "node:fs/promises";
import path from "node:path";

import { logAiCall, logAiCallComplete, logAiCallFailure } from "../ai-call-logger";
import { GCPStorageManager } from "../storage-manager";

interface GradioFile {
  path: string;
  url?: string;
  orig_name?: string;
}

export interface SynthesizedSpeech {
  audioUrl: string;
  durationSeconds: number;
  text: string;
}

export interface NarrationOptions {
  objectPrefix: string;
  maxDurationSeconds?: number;
  signal?: AbortSignal;
}

export interface SpeechBuffer {
  buffer: Buffer;
  durationSeconds: number;
  extension: string;
  mimeType: string;
}

const AUDIO_DIR = path.resolve(process.cwd(), "server/public/audio");
const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;

export function parseTtsEventStream(payload: string): GradioFile[] {
  const files: GradioFile[] = [];
  let event = "";
  const errors: string[] = [];
  for (const line of payload.split("\n")) {
    if (line.startsWith("event: ")) {
      event = line.slice(7).trim();
      continue;
    }
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const items = parsed?.data ?? parsed;
      if (event === "error" || parsed?.error) {
        const detail = typeof items === "string"
          ? items
          : typeof parsed?.error === "string"
            ? parsed.error
            : JSON.stringify(items);
        errors.push(detail);
        continue;
      }
      if (Array.isArray(items)) {
        for (const item of items) if (item?.path) files.push(item as GradioFile);
      } else if (items?.path) {
        files.push(items as GradioFile);
      }
    } catch (cause) {
      if (event === "error") errors.push(raw || String(cause));
      // Upstream progress events are not all JSON file descriptors.
    }
  }
  if (errors.length > 0) throw new Error(`TTS provider error: ${errors[0]}`);
  return files;
}

export function probeWavDuration(buffer: Buffer): number {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("TTS provider must return WAV audio so duration can be verified");
  }

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const bodyOffset = offset + 8;
    if (chunkId === "fmt " && chunkSize >= 16 && bodyOffset + 12 <= buffer.length) {
      byteRate = buffer.readUInt32LE(bodyOffset + 8);
    } else if (chunkId === "data") {
      dataSize = Math.min(chunkSize, Math.max(0, buffer.length - bodyOffset));
    }
    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }
  if (byteRate <= 0 || dataSize <= 0) throw new Error("Unable to read WAV duration metadata");
  return dataSize / byteRate;
}

export async function synthesizeSpeech(
  text: string,
  objectName = `tts-${generateUUID()}.wav`,
  signal?: AbortSignal,
): Promise<SynthesizedSpeech> {
  const speech = await generateSpeechBuffer(text, signal);
  return {
    audioUrl: await storeAudio(speech.buffer, objectName, speech.mimeType),
    durationSeconds: speech.durationSeconds,
    text,
  };
}

export async function synthesizeNarrationSegments(
  text: string,
  options: NarrationOptions,
): Promise<SynthesizedSpeech[]> {
  const generated = await synthesizeNarrationBuffers(text, options);
  return Promise.all(generated.map(async ({ text: segmentText, speech }, index) => ({
    audioUrl: await archiveSpeechBuffer(
      speech,
      `${sanitizeObjectPrefix(options.objectPrefix)}-${String(index).padStart(3, "0")}.${speech.extension}`,
    ),
    durationSeconds: speech.durationSeconds,
    text: segmentText,
  })));
}

/** Generate and duration-limit narration in memory for direct queue upload. */
export async function synthesizeNarrationBuffers(
  text: string,
  options: Omit<NarrationOptions, "objectPrefix">,
): Promise<Array<{ text: string; speech: SpeechBuffer }>> {
  const maxDurationSeconds = options.maxDurationSeconds ?? 25;
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds < 1 || maxDurationSeconds > 30) {
    throw new TypeError("maxDurationSeconds must be between 1 and 30");
  }
  const initialSegments = splitNarration(text, Math.min(200, Math.floor(maxDurationSeconds * 13)));

  const generateWithinLimit = async (
    segmentText: string,
  ): Promise<Array<{ text: string; speech: SpeechBuffer }>> => {
    options.signal?.throwIfAborted();
    const speech = await generateSpeechBuffer(segmentText, options.signal);
    if (speech.durationSeconds <= maxDurationSeconds) {
      return [{ text: segmentText, speech }];
    }
    const halves = splitInHalf(segmentText);
    if (!halves) {
      throw new Error(`Narration cannot be split below ${maxDurationSeconds} seconds`);
    }
    const [first, second] = await Promise.all([
      generateWithinLimit(halves[0]),
      generateWithinLimit(halves[1]),
    ]);
    return [...first, ...second];
  };

  const perSegment = await Promise.all(initialSegments.map((segment) => generateWithinLimit(segment)));

  return perSegment.flat();
}

export async function archiveSpeechBuffer(speech: SpeechBuffer, objectName: string): Promise<string> {
  return storeAudio(speech.buffer, objectName, speech.mimeType);
}

export async function generateSpeechBuffer(text: string, signal?: AbortSignal): Promise<SpeechBuffer> {
  const normalizedText = text.trim();
  if (!normalizedText) throw new TypeError("text is required");
  const apiUrl = process.env.HF_TTS_API_URL || process.env.VITE_TTS_API_URL;
  const token = process.env.HF_TOKEN;
  if (!apiUrl) throw new Error("TTS API URL not configured");
  if (!token) throw new Error("HF_TOKEN not configured");

  const aiCall = logAiCall({
    method: "generateSpeechBuffer",
    provider: "huggingface",
    parameters: { request: "POST /v2/gen_tts", hasAbortSignal: Boolean(signal) },
    input: normalizedText,
  });

  try {
    const historyPrompt = (process.env.TTS_HISTORY_PROMPT || "Speaker 1 (en)").trim();
    if (!historyPrompt) throw new Error("TTS_HISTORY_PROMPT cannot be blank");
    const callUrl = gradioCallUrl(apiUrl);
    const createResponse = await fetchWithTimeout(`${callUrl}/gen_tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: [normalizedText, historyPrompt] }),
    }, signal);
    if (!createResponse.ok) throw new Error(`TTS upstream create failed (${createResponse.status})`);
    const body = await createResponse.json() as { event_id?: string };
    if (!body.event_id) throw new Error("TTS upstream did not return an event id");

    const pollResponse = await fetchWithTimeout(`${callUrl}/gen_tts/${encodeURIComponent(body.event_id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, signal);
    if (!pollResponse.ok) throw new Error(`TTS upstream poll failed (${pollResponse.status})`);
    const payload = await pollResponse.text();
    const files = parseTtsEventStream(payload);
    const audio = [...files].reverse()
      .find((candidate) => /\.wav(?:$|[?#])/i.test(candidate.url || candidate.path))
      ?? files.at(-1);
    if (!audio) throw new Error("No audio generated");

    const audioUrl = new URL(audio.url || audio.path, callUrl).toString();
    const audioResponse = await fetchWithTimeout(audioUrl, {
      headers: { Authorization: `Bearer ${token}` },
    }, signal);
    if (!audioResponse.ok) throw new Error(`TTS audio download failed (${audioResponse.status})`);
    const buffer = Buffer.from(await audioResponse.arrayBuffer());
    const extension = audio.orig_name?.split(".").pop()?.toLowerCase() || "wav";
    if (extension !== "wav") throw new Error(`Unsupported TTS audio format: ${extension}`);
    const speech = { buffer, durationSeconds: probeWavDuration(buffer), extension, mimeType: "audio/wav" };
    logAiCallComplete("generateSpeechBuffer", aiCall, {
      durationSeconds: speech.durationSeconds,
      mimeType: speech.mimeType,
    });
    return speech;
  } catch (error) {
    logAiCallFailure("generateSpeechBuffer", aiCall, error);
    throw error;
  }
}

/** Normalize the configured Hugging Face Space URL to Gradio's call endpoint. */
function gradioCallUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/gradio_api/call")) {
    url.pathname = `${url.pathname}/gradio_api/call`.replace(/\/{2,}/g, "/");
  }
  return url.toString().replace(/\/$/, "");
}

async function storeAudio(buffer: Buffer, objectName: string, mimeType: string): Promise<string> {
  const bucket = process.env.GOOGLE_CLOUD_BUCKET;
  if (bucket) {
    const manager = new GCPStorageManager(process.env.GOOGLE_CLOUD_PROJECT || "", bucket);
    const result = await manager.uploadAudio(buffer, { fileName: objectName, mimeType });
    return result.audioPublicUri;
  }

  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (!publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL is required when GCS is unavailable");
  }
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  await fs.writeFile(path.join(AUDIO_DIR, path.basename(objectName)), buffer);
  return `${publicBaseUrl}/audio/${encodeURIComponent(path.basename(objectName))}`;
}

function splitNarration(text: string, targetCharacters: number): string[] {
  const sentences = text.trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
  if (sentences.length === 0) return [];
  const groups: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (current && candidate.length > targetCharacters) {
      groups.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) groups.push(current);
  return groups;
}

function splitInHalf(text: string): [string, string] | null {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return null;
  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint).join(" "), words.slice(midpoint).join(" ")];
}

function sanitizeObjectPrefix(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!sanitized) throw new TypeError("objectPrefix must contain a safe character");
  return sanitized;
}

async function fetchWithTimeout(url: string, init: RequestInit, upstreamSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.TTS_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(new Error(`TTS request timed out after ${timeoutMs}ms`)), timeoutMs);
  timeout.unref?.();
  const abort = () => controller.abort(upstreamSignal?.reason);
  upstreamSignal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abort);
  }
}
