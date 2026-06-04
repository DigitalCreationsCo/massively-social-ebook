import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import { GCPStorageManager } from "../storage-manager";
import { logger } from "../logger";

interface GradioFile {
  path: string;
  url?: string;
  size?: number | null;
  orig_name?: string;
}

function parseSSE(chunk: string): GradioFile[] {
  const files: GradioFile[] = [];
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const items = parsed?.data ?? parsed;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item?.path) files.push(item as GradioFile);
        }
      } else if (items?.path) {
        files.push(items as GradioFile);
      }
    } catch { /* skip unparseable */ }
  }
  return files;
}

function getStorageManager(): GCPStorageManager | null {
  const bucket = process.env.GOOGLE_CLOUD_BUCKET;
  if (!bucket) return null;
  try {
    return new GCPStorageManager(process.env.GOOGLE_CLOUD_PROJECT || "", bucket);
  } catch {
    return null;
  }
}

const AUDIO_DIR = path.resolve(process.cwd(), "server/public/audio");

async function storeAudio(
  buffer: Buffer,
  origName: string,
): Promise<string> {
  const storage = getStorageManager();

  if (storage) {
    const { audioPublicUri } = await storage.uploadAudio(buffer, {
      fileName: origName,
      mimeType: "audio/wav",
    });
    return audioPublicUri;
  }

  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const filepath = path.join(AUDIO_DIR, origName);
  fs.writeFileSync(filepath, buffer);
  return `/audio/${origName}`;
}

// ── In-memory rate limiter ─────────────────────────────────────────────────
// Per-IP sliding window: max N requests per WINDOW_MS
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const rateLimitMap = new Map<string, number[]>();

function rateLimiter(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) ?? [];
  const withinWindow = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (withinWindow.length >= MAX_REQUESTS_PER_WINDOW) return false;
  withinWindow.push(now);
  rateLimitMap.set(ip, withinWindow);
  return true;
}

// Periodically purge stale entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitMap) {
    const fresh = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
    if (fresh.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, fresh);
  }
}, 120_000);

// ── TTS auth middleware ────────────────────────────────────────────────────
function requireTtsAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  // 1. Origin check — reject requests from unknown origins
  const origin = req.headers.origin || req.headers.referer || "";
  if (origin) {
    const allowed = [
      process.env.CLIENT_ORIGIN,
      "https://25thchapter.com",
      ...(process.env.NODE_ENV !== "production" ? ["http://localhost:5001", "http://localhost:5173"] : []),
    ].filter(Boolean);
    const isAllowed = allowed.some((a) => origin.startsWith(a!));
    if (!isAllowed) {
      logger.warn("TTS blocked — unknown origin", "tts", { origin });
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  // 2. Optional API key (if configured, require match)
  const ttsApiKey = process.env.TTS_API_KEY;
  if (ttsApiKey) {
    const provided = req.headers["x-tts-api-key"] as string | undefined;
    if (provided !== ttsApiKey) {
      logger.warn("TTS blocked — invalid API key", "tts");
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  // 3. Rate limit
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!rateLimiter(ip)) {
    logger.warn("TTS rate limit exceeded", "tts", { ip });
    return res.status(429).json({ error: "Too many requests" });
  }

  next();
}

export function registerTtsRoutes(app: Express) {
  // Serve locally-stored audio files (dev fallback when GCS is not configured)
  app.use("/audio", express.static(AUDIO_DIR));

  const hfApiUrl = process.env.HF_TTS_API_URL || process.env.VITE_TTS_API_URL;
  const hfToken = process.env.HF_TOKEN;

  app.post("/api/tts/generate", requireTtsAuth, async (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }

    if (!hfApiUrl) {
      return res.status(500).json({ error: "TTS API URL not configured" });
    }

    if (!hfToken) {
      return res.status(500).json({ error: "HF_TOKEN not configured" });
    }

    const t0 = Date.now();

    try {
      // 1. Create TTS job
      const createRes = await fetch(`${hfApiUrl}/v2/gen_tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + hfToken,
        },
        body: JSON.stringify({ text }),
      });

      if (!createRes.ok) {
        const body = await createRes.text();
        logger.error("TTS create failed", "tts", {
          status: createRes.status,
          body,
        });
        return res.status(502).json({ error: "TTS upstream create failed" });
      }

      const { event_id } = await createRes.json();

      // 2. Poll via SSE stream
      const pollRes = await fetch(`${hfApiUrl}/gen_tts/${event_id}`, {
        headers: { Authorization: "Bearer " + hfToken },
      });

      if (!pollRes.ok) {
        logger.error("TTS poll failed", "tts", { status: pollRes.status });
        return res.status(502).json({ error: "TTS upstream poll failed" });
      }

      const reader = pollRes.body?.getReader();
      if (!reader) {
        return res.status(502).json({ error: "No response body from TTS" });
      }

      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }

      const files = parseSSE(buf);

      if (files.length === 0) {
        logger.error("No audio in TTS response", "tts", { raw: buf.slice(0, 500) });
        return res.status(502).json({ error: "No audio generated" });
      }

      const audio = files[0];
      const audioUrl = audio.url || audio.path;

      // 3. Download audio
      const audioRes = await fetch(audioUrl, {
        headers: { Authorization: "Bearer " + hfToken },
      });

      if (!audioRes.ok) {
        logger.error("TTS download failed", "tts", { status: audioRes.status });
        return res.status(502).json({ error: "Failed to download audio" });
      }

      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      // 4. Store in GCS (or local fallback).
      // Use event_id for uniqueness — Gradio's orig_name is always "audio.wav"
      // and would overwrite every file on every call.
      const ext = audio.orig_name?.includes(".")
        ? audio.orig_name.split(".").pop()
        : "wav";
      const uniqueName = `tts-${event_id}.${ext}`;
      const permanentUrl = await storeAudio(audioBuffer, uniqueName);

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      logger.info("TTS generated", "tts", {
        chars: text.length,
        elapsed: elapsed + "s",
        size: audioBuffer.length,
      });

      res.json({ audioUrl: permanentUrl });
    } catch (err) {
      logger.error("TTS error", "tts", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "TTS generation failed" });
    }
  });
}
