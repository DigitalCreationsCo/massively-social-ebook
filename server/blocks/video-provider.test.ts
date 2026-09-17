import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSubscribe, mockFalConfig } = vi.hoisted(() => ({
  mockSubscribe: vi.fn(),
  mockFalConfig: vi.fn(),
}));

vi.mock("@fal-ai/client", () => ({
  fal: { subscribe: mockSubscribe, config: mockFalConfig, run: vi.fn(), queue: {} },
}));

import {
  generateProviderVideo,
  VideoProviderError,
  getVideoMetrics,
  __resetVideoCostForTests,
  __resetVideoMetricsForTests,
} from "./ai-provider";

const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
  Buffer.alloc(64),
]);

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function bytesResponse(bytes: Buffer) {
  return new Response(Uint8Array.from(bytes) as BodyInit, { status: 200 });
}

describe("video providers (contract)", () => {
  beforeEach(() => {
    vi.stubEnv("AI_VIDEO_PROVIDER", "openrouter");
    vi.stubEnv("AI_VIDEO_MODEL", "google/veo-3.1");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("FAL_KEY", "fal-key");
    vi.stubEnv("VIDEO_DAILY_BUDGET_USD", "100");
    vi.stubEnv("VIDEO_POLL_INTERVAL_MS", "1");
    vi.stubEnv("VIDEO_POLL_TIMEOUT_MS", "5000");
    vi.stubEnv("VIDEO_GEN_RETRY_BASE_MS", "1");
    __resetVideoCostForTests();
    __resetVideoMetricsForTests();
    mockSubscribe.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("submits the documented OpenRouter shape then polls to completion", async () => {
    const calls: Array<{ url: string; init: RequestInit & { body?: string } }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init: init as RequestInit & { body?: string } });
      if (String(url) === "https://openrouter.ai/api/v1/videos") {
        return jsonResponse({ id: "job-1", polling_url: "/api/v1/videos/job-1", status: "pending" }, 202);
      }
      if (String(url) === "https://openrouter.ai/api/v1/videos/job-1") {
        return jsonResponse({
          id: "job-1",
          polling_url: "/api/v1/videos/job-1",
          status: "completed",
          unsigned_urls: ["https://cdn.example.com/v.mp4"],
          usage: { cost: 1.25 },
        });
      }
      return bytesResponse(MP4);
    }));

    const result = await generateProviderVideo({ text: "a calm lake", duration: 8 });

    // Submit body matches the documented POST /api/v1/videos schema.
    const submit = calls[0]!;
    expect(submit.url).toBe("https://openrouter.ai/api/v1/videos");
    expect(JSON.parse(submit.init.body!)).toMatchObject({
      model: "google/veo-3.1",
      prompt: "a calm lake",
      aspect_ratio: "16:9",
      duration: 8,
      resolution: "720p",
      generate_audio: true,
    });
    // Prefers provider-reported usage.cost over the estimate.
    expect(result.cost).toBeCloseTo(1.25);
    expect(result.videoBuffer.length).toBeGreaterThan(0);
    expect(getVideoMetrics().successes).toBe(1);
  });

  it("keeps polling through pending/in_progress until completed", async () => {
    let polls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url) === "https://openrouter.ai/api/v1/videos") {
        return jsonResponse({ id: "job-2", polling_url: "/api/v1/videos/job-2", status: "pending" }, 202);
      }
      if (String(url) === "https://openrouter.ai/api/v1/videos/job-2") {
        polls += 1;
        if (polls === 1) {
          return jsonResponse({ id: "job-2", polling_url: "/api/v1/videos/job-2", status: "in_progress" });
        }
        return jsonResponse({
          id: "job-2",
          polling_url: "/api/v1/videos/job-2",
          status: "completed",
          unsigned_urls: ["https://cdn.example.com/v2.mp4"],
          usage: { cost: 0.5 },
        });
      }
      return bytesResponse(MP4);
    }));

    const result = await generateProviderVideo({ text: "slow push in" });
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(result.filename).toContain("job-2");
  });

  it("maps OpenRouter error statuses to typed codes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { message: "bad" } }, 400)));
    await expect(generateProviderVideo({ text: "x" })).rejects.toMatchObject({ code: "invalid_request" });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { message: "pay" } }, 402)));
    await expect(generateProviderVideo({ text: "x" })).rejects.toMatchObject({ code: "quota_exceeded" });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { message: "denied" } }, 401)));
    await expect(generateProviderVideo({ text: "x" })).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("surfaces failed jobs instead of hanging", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url) === "https://openrouter.ai/api/v1/videos") {
        return jsonResponse({ id: "job-3", polling_url: "/api/v1/videos/job-3", status: "pending" }, 202);
      }
      return jsonResponse({ id: "job-3", polling_url: "/api/v1/videos/job-3", status: "failed", error: "safety" });
    }));

    await expect(generateProviderVideo({ text: "x" })).rejects.toThrow(/job-3.*failed/s);
  });

  it("times out jobs that never complete", async () => {
    vi.stubEnv("VIDEO_POLL_TIMEOUT_MS", "30");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url) === "https://openrouter.ai/api/v1/videos") {
        return jsonResponse({ id: "job-4", polling_url: "/api/v1/videos/job-4", status: "pending" }, 202);
      }
      return jsonResponse({ id: "job-4", polling_url: "/api/v1/videos/job-4", status: "pending" });
    }));

    const err = await generateProviderVideo({ text: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(VideoProviderError);
    expect((err as VideoProviderError).code).toBe("timeout");
  });

  it("rejects before spending when the daily budget is exhausted", async () => {
    vi.stubEnv("VIDEO_DAILY_BUDGET_USD", "0.01");
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateProviderVideo({ text: "x", duration: 8 })).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends fal the documented veo3.1 input shape with snapped values", async () => {
    vi.stubEnv("AI_VIDEO_PROVIDER", "fal");
    vi.stubEnv("AI_VIDEO_MODEL", "fal-ai/veo3.1");
    mockSubscribe.mockResolvedValue({ video: { url: "https://fal.media/v.mp4" } });
    vi.stubGlobal("fetch", vi.fn(async () => bytesResponse(MP4)));

    const result = await generateProviderVideo({ text: "aerial coast", duration: 5, aspectRatio: "1:1" });

    expect(mockSubscribe).toHaveBeenCalledOnce();
    const [model, opts] = mockSubscribe.mock.calls[0] as [string, { input: Record<string, unknown> }];
    expect(model).toBe("fal-ai/veo3.1");
    expect(opts.input).toMatchObject({
      prompt: "aerial coast",
      aspect_ratio: "16:9", // 1:1 normalized — fal only accepts 16:9/9:16
      duration: "4s", // 5 snapped to the enum
      resolution: "720p",
      generate_audio: true,
    });
    expect(result.durationSeconds).toBe(4);
    expect(result.videoBuffer.length).toBeGreaterThan(0);
  });

  it("maps fal quota failures to quota_exceeded", async () => {
    vi.stubEnv("AI_VIDEO_PROVIDER", "fal");
    mockSubscribe.mockRejectedValue(new Error("Request failed with status 402"));
    vi.stubGlobal("fetch", vi.fn(async () => bytesResponse(MP4)));

    await expect(generateProviderVideo({ text: "x" })).rejects.toMatchObject({ code: "quota_exceeded" });
  });

  it("falls back to authenticated endpoint when unsigned URL returns 401", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (String(url) === "https://openrouter.ai/api/v1/videos") {
        return jsonResponse({ id: "job-401", polling_url: "/api/v1/videos/job-401", status: "pending" }, 202);
      }
      if (String(url) === "https://openrouter.ai/api/v1/videos/job-401") {
        return jsonResponse({
          id: "job-401",
          polling_url: "/api/v1/videos/job-401",
          status: "completed",
          unsigned_urls: ["https://cdn.example.com/v401.mp4"],
          usage: { cost: 0.5 },
        });
      }
      // Unsigned URL returns 401
      if (String(url) === "https://cdn.example.com/v401.mp4") {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      // Authenticated fallback endpoint
      if (String(url) === "https://openrouter.ai/api/v1/videos/job-401/content?index=0") {
        return bytesResponse(MP4);
      }
      return bytesResponse(MP4);
    }));

    const result = await generateProviderVideo({ text: "fallback test" });
    
    // Should have tried unsigned URL first, then fallen back to authenticated
    const unsignedCall = calls.find(c => c.url === "https://cdn.example.com/v401.mp4");
    const authCall = calls.find(c => c.url === "https://openrouter.ai/api/v1/videos/job-401/content?index=0");
    
    expect(unsignedCall).toBeDefined();
    expect(authCall).toBeDefined();
    expect(authCall?.init.headers).toMatchObject({ Authorization: "Bearer or-key" });
    expect(result.videoBuffer.length).toBeGreaterThan(0);
    expect(getVideoMetrics().successes).toBe(1);
  });

  it("throws error when unsigned URL fails with non-auth error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url) === "https://openrouter.ai/api/v1/videos") {
        return jsonResponse({ id: "job-500", polling_url: "/api/v1/videos/job-500", status: "pending" }, 202);
      }
      if (String(url) === "https://openrouter.ai/api/v1/videos/job-500") {
        return jsonResponse({
          id: "job-500",
          polling_url: "/api/v1/videos/job-500",
          status: "completed",
          unsigned_urls: ["https://cdn.example.com/v500.mp4"],
          usage: { cost: 0.5 },
        });
      }
      // Unsigned URL returns 500 (server error)
      if (String(url) === "https://cdn.example.com/v500.mp4") {
        return jsonResponse({ error: "server error" }, 500);
      }
      return bytesResponse(MP4);
    }));

    await expect(generateProviderVideo({ text: "error test" })).rejects.toMatchObject({ 
      code: "generation_failed",
      status: 500 
    });
  });
});
