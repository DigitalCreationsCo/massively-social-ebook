import { describe, expect, it } from "vitest";

import { parseTtsEventStream, probeWavDuration } from "./tts-service";

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
});
