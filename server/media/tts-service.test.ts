import { afterEach, describe, expect, it, vi } from "vitest";

import { generateSpeechBuffer, parseTtsEventStream, probeWavDuration } from "./tts-service";

function makeWav(durationSeconds: number, byteRate = 8_000): Buffer {
  const dataSize = Math.round(durationSeconds * byteRate);
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(byteRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

describe("TTS media helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HF_TTS_API_URL;
    delete process.env.VITE_TTS_API_URL;
    delete process.env.HF_TOKEN;
    delete process.env.TTS_HISTORY_PROMPT;
  });

  it("probes the synthesized WAV duration instead of estimating from text", () => {
    expect(probeWavDuration(makeWav(2.75))).toBeCloseTo(2.75, 3);
  });

  it("rejects audio without verifiable WAV metadata", () => {
    expect(() => probeWavDuration(Buffer.from("not audio"))).toThrow(/WAV/i);
  });

  it("extracts file descriptors while ignoring upstream progress events", () => {
    const files = parseTtsEventStream([
      "event: generating",
      "data: not-json",
      'data: {"data":[{"path":"/tmp/result.wav","orig_name":"result.wav"}]}',
    ].join("\n"));

    expect(files).toEqual([{ path: "/tmp/result.wav", orig_name: "result.wav" }]);
  });

  it("surfaces a Gradio SSE provider error instead of reporting missing audio", () => {
    expect(() => parseTtsEventStream([
      "event: error",
      'data: {"error":"history_prompt is invalid"}',
    ].join("\n"))).toThrow("history_prompt is invalid");
  });

  it("uses Bark's server-only speaker preset and selects the final WAV event", async () => {
    process.env.HF_TTS_API_URL = "https://suno-bark.hf.space/gradio_api/call";
    process.env.HF_TOKEN = "server-token";
    process.env.TTS_HISTORY_PROMPT = "Speaker 7 (en)";
    const requestFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ event_id: "event-1" })))
      .mockResolvedValueOnce(new Response([
        "event: complete",
        'data: {"data":[{"path":"/tmp/progress.txt","orig_name":"progress.txt"}]}',
        'data: {"data":[{"path":"/tmp/final.wav","orig_name":"final.wav"}]}',
      ].join("\n")))
      .mockResolvedValueOnce(new Response(makeWav(1.5)));
    vi.stubGlobal("fetch", requestFetch);

    await expect(generateSpeechBuffer("Hello from the narrator.")).resolves.toMatchObject({
      durationSeconds: 1.5,
      extension: "wav",
    });
    expect(requestFetch.mock.calls[0][0]).toBe("https://suno-bark.hf.space/gradio_api/call/gen_tts");
    expect(JSON.parse(requestFetch.mock.calls[0][1].body)).toEqual({
      data: ["Hello from the narrator.", "Speaker 7 (en)"],
    });
    expect(requestFetch.mock.calls[1][0]).toBe("https://suno-bark.hf.space/gradio_api/call/gen_tts/event-1");
    expect(requestFetch.mock.calls[2][0]).toBe("https://suno-bark.hf.space/tmp/final.wav");
  });
});
