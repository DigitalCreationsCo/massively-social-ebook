import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { registerTtsRoutes } from "./tts-routes";

// ── Hoisted mock instance ────────────────────────────────────────────────────
// vi.hoisted() runs before the mock factories so mockGcsInstance is available
// when vi.mock('../storage-manager') executes.
const { mockGcsInstance } = vi.hoisted(() => {
  const gcsMock = {
    fileExists: vi.fn(),
    createReadStream: vi.fn(),
    uploadAudio: vi.fn(),
  };
  return { mockGcsInstance: gcsMock };
});

// ── Module-level mocks ──────────────────────────────────────────────────────
// IMPORTANT: Use a plain function (not vi.fn()) for the constructor so that
// vi.clearAllMocks() does not erase the implementation.  clearAllMocks only
// clears vi.fn() spies, and we need the constructor to keep returning the
// mock instance across all tests within a describe block.
vi.mock("../storage-manager", () => {
  function MockGCPStorageManager() {
    return mockGcsInstance;
  }
  return { GCPStorageManager: MockGCPStorageManager };
});

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../storage", () => ({
  storage: {
    getBlockById: vi.fn(),
    getSessionById: vi.fn(),
    updateBlock: vi.fn(),
    updateSession: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const AUDIO_DIR = path.resolve(process.cwd(), "server/public/audio");

/** Build a minimal Express app with just the TTS routes. */
function buildApp(): Express {
  const app = express();
  app.use(express.json());
  registerTtsRoutes(app);
  return app;
}

/** Create a Readable stream that yields given content then closes. */
function createTestStream(content?: Buffer): Readable {
  return new Readable({
    read() {
      this.push(content ?? Buffer.from("fake audio data"));
      this.push(null);
    },
  });
}

/** Names of test audio files created on disk for local-fallback tests. */
const TEST_FILES = ["test-audio.wav", "test-audio.mp3", "test-local-only.wav"];

beforeAll(() => {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  for (const file of TEST_FILES) {
    fs.writeFileSync(path.join(AUDIO_DIR, file), Buffer.from("audio data"));
  }
});

afterAll(() => {
  for (const file of TEST_FILES) {
    try {
      fs.unlinkSync(path.join(AUDIO_DIR, file));
    } catch {
      // best-effort cleanup
    }
  }
});

// ── Test suites ──────────────────────────────────────────────────────────────

describe("GET /api/tts/audio/:filename (with GCS configured)", () => {
  let app: Express;

  beforeAll(() => {
    process.env.GOOGLE_CLOUD_BUCKET = "test-bucket";
    process.env.GOOGLE_CLOUD_PROJECT = "test-project";
  });

  afterAll(() => {
    delete process.env.GOOGLE_CLOUD_BUCKET;
    delete process.env.GOOGLE_CLOUD_PROJECT;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("streams audio from GCS when file exists", async () => {
    const expectedContent = Buffer.from("RIFF...WAV audio content");
    mockGcsInstance.fileExists.mockResolvedValue(true);
    mockGcsInstance.createReadStream.mockReturnValue(
      createTestStream(expectedContent),
    );

    const res = await request(app)
      .get("/api/tts/audio/test-audio.wav")
      .buffer(true);

    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body).toEqual(expectedContent);
    expect(mockGcsInstance.fileExists).toHaveBeenCalledWith(
      "audio/test-audio.wav",
    );
    expect(mockGcsInstance.createReadStream).toHaveBeenCalledWith(
      "audio/test-audio.wav",
    );
  });

  it("sets Content-Type to audio/wav for .wav files", async () => {
    mockGcsInstance.fileExists.mockResolvedValue(true);
    mockGcsInstance.createReadStream.mockReturnValue(createTestStream());

    const res = await request(app)
      .get("/api/tts/audio/speech.wav")
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/wav");
  });

  it("sets Content-Type to audio/mpeg for .mp3 files", async () => {
    mockGcsInstance.fileExists.mockResolvedValue(true);
    mockGcsInstance.createReadStream.mockReturnValue(createTestStream());

    const res = await request(app)
      .get("/api/tts/audio/speech.mp3")
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
  });

  it("sets Content-Type to audio/ogg for .ogg files", async () => {
    mockGcsInstance.fileExists.mockResolvedValue(true);
    mockGcsInstance.createReadStream.mockReturnValue(createTestStream());

    const res = await request(app)
      .get("/api/tts/audio/loop.ogg")
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/ogg");
  });

  it("returns application/octet-stream for unknown extensions", async () => {
    mockGcsInstance.fileExists.mockResolvedValue(true);
    mockGcsInstance.createReadStream.mockReturnValue(createTestStream());

    const res = await request(app)
      .get("/api/tts/audio/speech.dat")
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
  });

  it("sets Cache-Control and X-Proxy-Backend headers", async () => {
    mockGcsInstance.fileExists.mockResolvedValue(true);
    mockGcsInstance.createReadStream.mockReturnValue(createTestStream());

    const res = await request(app)
      .get("/api/tts/audio/speech.wav")
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000");
    expect(res.headers["x-proxy-backend"]).toBe("gcs");
  });

  it("returns 404 when file does not exist in GCS or locally", async () => {
    mockGcsInstance.fileExists.mockResolvedValue(false);

    const res = await request(app)
      .get("/api/tts/audio/nonexistent.wav")
      .buffer(true);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Audio not found" });
  });

  it("falls back to local when GCS file does not exist but local file does", async () => {
    mockGcsInstance.fileExists.mockResolvedValue(false);

    const res = await request(app)
      .get("/api/tts/audio/test-local-only.wav")
      .buffer(true);

    expect(res.status).toBe(200);
    // sendFile derives content-type from the file extension
    expect(res.headers["content-type"]).toContain("audio/wav");
    // Verify we served the real file (not GCS mock data)
    expect(res.body).toBeDefined();
    expect(res.body.length).toBeGreaterThan(0);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    // No X-Proxy-Backend header since we didn't serve from GCS
    expect(res.headers["x-proxy-backend"]).toBeUndefined();
  });

  it("falls back to local when GCS lookup throws an error", async () => {
    mockGcsInstance.fileExists.mockRejectedValue(
      new Error("GCS unavailable"),
    );

    const res = await request(app)
      .get("/api/tts/audio/test-local-only.wav")
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(res.body.length).toBeGreaterThan(0);
    expect(mockGcsInstance.fileExists).toHaveBeenCalled();
    // Logger should have recorded the fallback warning
    const { logger } = await import("../logger");
    expect(logger.warn).toHaveBeenCalledWith(
      "GCS lookup failed, falling back to local",
      "tts",
      expect.any(Error),
    );
  });

  it("returns 502 when GCS stream errors before headers sent", async () => {
    mockGcsInstance.fileExists.mockResolvedValue(true);

    // A stream that errors on first read with no data emitted.
    // The error handler fires before headers flush, so it can still
    // send a 502 JSON response.  (Content-Type is still "audio/wav" —
    // set before the error — so supertest stores the body as a Buffer.)
    const errorStream = new Readable({
      read() {
        this.destroy(new Error("GCS internal error"));
      },
    });
    mockGcsInstance.createReadStream.mockReturnValue(errorStream);

    const res = await request(app).get("/api/tts/audio/speech.wav");

    expect(res.status).toBe(502);
    // body is a Buffer because Content-Type is audio/wav, not application/json
    const body = Buffer.isBuffer(res.body)
      ? JSON.parse(res.body.toString())
      : res.body;
    expect(body).toEqual({ error: "Failed to stream audio" });
  });
});

describe("GET /api/tts/audio/:filename (path traversal protection)", () => {
  let app: Express;

  beforeAll(() => {
    process.env.GOOGLE_CLOUD_BUCKET = "test-bucket";
  });

  afterAll(() => {
    delete process.env.GOOGLE_CLOUD_BUCKET;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("rejects filenames that contain literal ..", async () => {
    // Express normalises .. in URL paths before routing, so path-traversal
    // attempts like /../../../etc/passwd never reach the handler.
    // What CAN reach it is a filename segment that happens to contain ..
    // (e.g. a hash or encoded form).  We test the guard directly.
    const res = await request(app)
      .get("/api/tts/audio/test..wav")
      .buffer(true);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid filename" });
    expect(mockGcsInstance.fileExists).not.toHaveBeenCalled();
  });

  it("rejects filenames containing URL-encoded ..", async () => {
    // %2e%2e decodes to .. — Express will decode this and the guard catches it
    const res = await request(app)
      .get("/api/tts/audio/test%2e%2e.wav")
      .buffer(true);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid filename" });
  });

  it("rejects multi-segment paths with forward slash", async () => {
    // Express naturally rejects multi-segment paths in a single :param
    // (the route won't match), so we get 404.  This is correct behaviour;
    // the important thing is that the path never reaches the handler.
    const res = await request(app)
      .get("/api/tts/audio/some/dir/file.wav")
      .buffer(true);

    expect(res.status).toBe(404);
    expect(mockGcsInstance.fileExists).not.toHaveBeenCalled();
  });

  it("rejects filenames containing backslash", async () => {
    // Backslash in a URL is unusual; Express may keep it or normalise it.
    // We test that the guard catches it regardless.
    const res = await request(app)
      .get("/api/tts/audio/test%5cfile.wav")
      .buffer(true);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid filename" });
  });

  it("rejects empty filename segment (route does not match)", async () => {
    const res = await request(app)
      .get("/api/tts/audio/")
      .buffer(true);

    // The route requires a non-empty segment, so Express falls through to
    // whichever handler matches next (the 404 catch-all).
    expect(res.status).toBe(404);
    expect(mockGcsInstance.fileExists).not.toHaveBeenCalled();
  });
});

describe("GET /api/tts/audio/:filename (without GCS configured)", () => {
  let app: Express;
  const originalBucket = process.env.GOOGLE_CLOUD_BUCKET;

  beforeAll(() => {
    // Ensure no bucket is configured so getStorageManager() returns null
    delete process.env.GOOGLE_CLOUD_BUCKET;
  });

  afterAll(() => {
    if (originalBucket) process.env.GOOGLE_CLOUD_BUCKET = originalBucket;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("serves audio from local directory when file exists", async () => {
    const res = await request(app)
      .get("/api/tts/audio/test-audio.wav")
      .buffer(true);

    expect(res.status).toBe(200);
    // sendFile streams the file; supertest captures the body as a Buffer
    expect(res.body).toBeDefined();
    expect(res.body.length).toBeGreaterThan(0);
    expect(Buffer.isBuffer(res.body)).toBe(true);
  });

  it("returns 404 when file does not exist locally", async () => {
    const res = await request(app)
      .get("/api/tts/audio/no-such-file.wav")
      .buffer(true);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Audio not found" });
  });
});

// ── Integration: storeAudio URL format ───────────────────────────────────────

describe("storeAudio behavior (via generation endpoint contract)", () => {
  let app: Express;

  beforeAll(() => {
    process.env.GOOGLE_CLOUD_BUCKET = "test-bucket";
    process.env.GOOGLE_CLOUD_PROJECT = "test-project";
    process.env.HF_TTS_API_URL = "https://fake-hf.example.com";
    process.env.HF_TOKEN = "fake-token";
  });

  afterAll(() => {
    delete process.env.GOOGLE_CLOUD_BUCKET;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.HF_TTS_API_URL;
    delete process.env.HF_TOKEN;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  /**
   * Helper: mocks global fetch so the generate endpoint thinks it's talking
   * to the real Hugging Face API.  Returns the mock so callers can add more
   * behaviour if needed, and sets uploadAudio to succeed by default.
   */
  function mockHfApi(eventId: string, audioBody?: Buffer) {
    const sseBody =
      `data: {"data": [{"path": "/tmp/audio.wav", "orig_name": "audio.wav"}]}\n\n`;

    const fetchMock = vi
      .fn()
      // 1. POST create → event_id
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ event_id: eventId }), { status: 200 }),
      )
      // 2. GET poll → SSE
      .mockResolvedValueOnce(new Response(sseBody, { status: 200 }))
      // 3. GET audio download → bytes
      .mockResolvedValueOnce(
        new Response(audioBody ?? Buffer.from("audio bytes"), {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        }),
      );

    const orig = globalThis.fetch;
    globalThis.fetch = fetchMock;

    mockGcsInstance.uploadAudio.mockResolvedValue({
      audioPublicUri: `https://storage.googleapis.com/test-bucket/audio/tts-${eventId}.wav`,
      audioGcsUri: `gs://test-bucket/audio/tts-${eventId}.wav`,
    });

    // Return a restore function
    return () => {
      globalThis.fetch = orig;
    };
  }

  it("returns a relative /api/tts/audio/ URL when GCS is configured", async () => {
    const eventId = "evt-12345";
    const restoreFetch = mockHfApi(eventId);

    const res = await request(app)
      .post("/api/tts/generate")
      .send({ text: "Hello world" });

    restoreFetch();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("audioUrl");

    const { audioUrl } = res.body;
    expect(audioUrl).toBe(`/api/tts/audio/tts-${eventId}.wav`);
    expect(audioUrl).not.toContain("storage.googleapis.com");
  });

  it("still uploads audio to GCS even though it returns a proxy URL", async () => {
    const eventId = "evt-upload-check";
    const restoreFetch = mockHfApi(eventId);

    const res = await request(app)
      .post("/api/tts/generate")
      .send({ text: "Upload test" });

    restoreFetch();

    expect(res.status).toBe(200);
    // Verify the audio was actually uploaded to GCS (not just proxied)
    expect(mockGcsInstance.uploadAudio).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        fileName: `tts-${eventId}.wav`,
        mimeType: "audio/wav",
      }),
    );
  });

  it("rejects request when text is missing", async () => {
    const res = await request(app)
      .post("/api/tts/generate")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("rejects request when TTS API is not configured", async () => {
    // hfApiUrl is captured at registerTtsRoutes() call time, so we must
    // build a fresh app with all TTS env vars unset.  VITE_TTS_API_URL is
    // a fallback for HF_TTS_API_URL, so both must go.
    const origUrl = process.env.HF_TTS_API_URL;
    const origViteUrl = process.env.VITE_TTS_API_URL;
    const origToken = process.env.HF_TOKEN;
    delete process.env.HF_TTS_API_URL;
    delete process.env.VITE_TTS_API_URL;
    delete process.env.HF_TOKEN;

    const appWithoutApi = buildApp();

    if (origUrl) process.env.HF_TTS_API_URL = origUrl;
    if (origViteUrl) process.env.VITE_TTS_API_URL = origViteUrl;
    if (origToken) process.env.HF_TOKEN = origToken;

    const res = await request(appWithoutApi)
      .post("/api/tts/generate")
      .send({ text: "test" });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("TTS API URL not configured");
  });
});
