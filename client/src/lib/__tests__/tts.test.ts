import { describe, it, expect, vi, afterEach } from "vitest";
import { textToSpeech } from "@/lib/tts";

function mockOkResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(""),
  } as unknown as Response;
}

function mockErrorResponse(status: number, statusText: string, body = "") {
  return {
    ok: false,
    status,
    statusText,
    headers: new Headers(),
    json: vi.fn().mockRejectedValue(new Error("not json")),
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("textToSpeech", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("happy path", () => {
    it("returns audio URL when server responds with one", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockOkResponse({ audioUrl: "https://cdn.example.com/audio.wav" }),
        );

      const result = await textToSpeech("hello");
      expect(result).toBe("https://cdn.example.com/audio.wav");
    });

    it("POSTs to /api/tts/generate with the correct body", async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockOkResponse({ audioUrl: "https://cdn.example.com/audio.wav" }),
        );
      globalThis.fetch = fetchSpy;

      await textToSpeech("Read me aloud");

      expect(fetchSpy).toHaveBeenCalledWith("/api/tts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Read me aloud" }),
      });
    });

    it("handles long text", async () => {
      const longText = "a".repeat(5000);
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockOkResponse({ audioUrl: "https://cdn.example.com/audio.wav" }),
        );

      const result = await textToSpeech(longText);
      expect(result).toBe("https://cdn.example.com/audio.wav");
    });
  });

  describe("server error", () => {
    it("returns null when server responds with non-ok status", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockErrorResponse(500, "Internal Server Error"));

      const result = await textToSpeech("hello");
      expect(result).toBeNull();
    });

    it("logs error on server failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockErrorResponse(502, "Bad Gateway"));

      await textToSpeech("hello");
      expect(spy).toHaveBeenCalledWith(
        "[TTS] Failed: 502 Bad Gateway",
      );
    });
  });

  describe("network error", () => {
    it("returns null when fetch throws", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError("Failed to fetch"));

      const result = await textToSpeech("hello");
      expect(result).toBeNull();
    });

    it("logs the error", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError("Network error"));

      await textToSpeech("hello");
      expect(spy).toHaveBeenCalledWith(
        "[TTS] Error:",
        expect.any(TypeError),
      );
    });
  });
});
