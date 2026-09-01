import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import { GCPStorageManager } from "../storage-manager";
import { logger } from "../logger";
import { storage } from "../storage";
import { synthesizeSpeech } from "../media/tts-service";

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

  app.post("/api/tts/generate", requireTtsAuth, async (req, res) => {
    const { text, blockId: rawBlockId, sessionId: rawSessionId } = req.body as Record<string, unknown>;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }

    // ── Input validation: only accept positive integers for entity IDs ─────
    const blockId = typeof rawBlockId === "number" && Number.isInteger(rawBlockId) && rawBlockId > 0
      ? rawBlockId
      : undefined;
    const sessionId = typeof rawSessionId === "number" && Number.isInteger(rawSessionId) && rawSessionId > 0
      ? rawSessionId
      : undefined;

    // ── Cache check: block already has audio → return it ──────────────────
    if (blockId) {
      try {
        const block = await storage.getBlockById(blockId);
        if (block?.audioUrl) {
          logger.info("TTS cache hit (block)", "tts", { blockId, audioUrl: block.audioUrl });
          return res.json({ audioUrl: block.audioUrl, cached: true });
        }
      } catch (err) {
        logger.warn("TTS block lookup failed, proceeding with generation", "tts",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    // ── Cache check: session already has backing track → return it ────────
    if (sessionId) {
      try {
        const session = await storage.getSessionById(sessionId);
        if (session?.backingTrackUrl) {
          logger.info("TTS cache hit (session)", "tts", { sessionId, audioUrl: session.backingTrackUrl });
          return res.json({ audioUrl: session.backingTrackUrl, cached: true });
        }
      } catch (err) {
        logger.warn("TTS session lookup failed, proceeding with generation", "tts",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    const t0 = Date.now();

    try {
      const speech = await synthesizeSpeech(text);
      const permanentUrl = speech.audioUrl;

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      logger.info("TTS generated", "tts", {
        chars: text.length,
        elapsed: elapsed + "s",
        durationSeconds: speech.durationSeconds,
      });

      // ── Persist: save URL to block or session record ─────────────────────────
      if (blockId) {
        try {
          await storage.updateBlock(blockId, { audioUrl: permanentUrl });
          logger.info("TTS URL saved to block", "tts", { blockId, audioUrl: permanentUrl });
        } catch (err) {
          logger.warn("Failed to save TTS URL to block", "tts",
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }

      if (sessionId) {
        try {
          await storage.updateSession(sessionId, { backingTrackUrl: permanentUrl });
          logger.info("TTS URL saved to session backing track", "tts", { sessionId });
        } catch (err) {
          logger.warn("Failed to save TTS URL to session", "tts",
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }

      res.json({ audioUrl: permanentUrl, durationSeconds: speech.durationSeconds });
    } catch (err) {
      logger.error("TTS error", "tts", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "TTS generation failed" });
    }
  });

  // ── Audio proxy route ─────────────────────────────────────────────────────
  // Serves audio files from GCS (or local fallback) so CORS is handled by the
  // Express middleware instead of requiring GCS bucket-level CORS configuration.
  app.get("/api/tts/audio/:filename", async (req, res) => {
    const { filename } = req.params;

    // ── Path traversal guard ──────────────────────────────────────────────
    // Reject any filename with directory components to prevent reading
    // arbitrary files from the filesystem or GCS bucket.
    if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return res.status(400).json({ error: "Invalid filename" });
    }

    // ── Derive Content-Type from extension ────────────────────────────────
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".flac": "audio/flac",
      ".m4a": "audio/mp4",
      ".aac": "audio/aac",
      ".webm": "audio/webm",
    };
    const contentType = mimeMap[ext] || "application/octet-stream";

    // ── Try GCS first ─────────────────────────────────────────────────────
    const storage = getStorageManager();
    if (storage) {
      try {
        const gcsPath = `audio/${filename}`;
        const exists = await storage.fileExists(gcsPath);
        if (exists) {
          res.setHeader("Content-Type", contentType);
          res.setHeader("Cache-Control", "public, max-age=31536000");
          res.setHeader("X-Proxy-Backend", "gcs");

          const stream = storage.createReadStream(gcsPath);

          // Manual piping instead of stream.pipe() so we own error handling.
          // pipe()'s internal error handler calls dest.destroy() which flushes
          // headers and prevents us from sending a 502 JSON response.
          stream.on("data", (chunk: Buffer) => {
            if (!res.write(chunk) && !stream.isPaused()) {
              stream.pause();
              res.once("drain", () => stream.resume());
            }
          });
          stream.on("end", () => {
            res.end();
          });
          stream.on("error", (streamErr) => {
            logger.error(
              "GCS stream error",
              "tts",
              streamErr instanceof Error ? streamErr : new Error(String(streamErr)),
            );
            // Only send error if headers haven't been sent yet
            if (!res.headersSent) {
              res.status(502).json({ error: "Failed to stream audio" });
            }
          });
          return;
        }
      } catch (err) {
        logger.warn(
          "GCS lookup failed, falling back to local",
          "tts",
          err instanceof Error ? err : new Error(String(err)),
        );
        // Fall through to local fallback
      }
    }

    // ── Fallback: local directory ─────────────────────────────────────────
    const localPath = path.resolve(AUDIO_DIR, filename);
    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    // ── Not found anywhere ────────────────────────────────────────────────
    res.status(404).json({ error: "Audio not found" });
  });
}
