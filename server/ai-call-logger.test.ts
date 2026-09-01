import { afterEach, describe, expect, it, vi } from "vitest";

import {
  logAiCall,
  logAiCallComplete,
  logAiCallFailure,
  logAiConfiguration,
} from "./ai-call-logger";

describe("AI call logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints the method, resolved model, parameters, and complete prompt", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const call = logAiCall({
      method: "generateText",
      provider: "google",
      model: "gemini-test",
      parameters: { output: { format: "object" } },
      instructions: "Follow the story rules.",
      prompt: "Write the next scene.",
    });

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("[AI] generateText call"),
    );
    const record = info.mock.calls[0][0] as string;
    expect(record).toContain('"provider":"google"');
    expect(record).toContain('"model":"gemini-test"');
    expect(record).toContain('"format":"object"');
    expect(record).toContain("[AI] generateText instructions:\nFollow the story rules.");
    expect(record).toContain("[AI] generateText prompt:\nWrite the next scene.");
    expect(call.callId).toEqual(expect.any(Number));
  });

  it("reports completions and failures without dumping result payloads", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const call = { callId: 42, startedAt: Date.now() };

    logAiCallComplete("embed", call, {
      embedding: "returned",
      response: { content: "The lantern went out." },
    });
    logAiCallFailure("embed", call, new Error("provider unavailable"));

    expect(info).toHaveBeenCalledWith(expect.stringContaining('"embedding":"returned"'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"content":"The lantern went out."'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"error":"provider unavailable"'));
  });

  it("prints configured providers and models once at startup", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logAiConfiguration({
      text: { provider: "google", model: "gemini-text" },
      image: { provider: "openai", model: "gpt-image" },
      embedding: { provider: "google", model: "gemini-embedding" },
    });

    expect(info).toHaveBeenCalledWith(
      '[AI] configured models {"text":{"provider":"google","model":"gemini-text"},"image":{"provider":"openai","model":"gpt-image"},"embedding":{"provider":"google","model":"gemini-embedding"}}',
    );
  });
});
