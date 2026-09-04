import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), tools: vi.fn(), list: vi.fn(), close: vi.fn(), transportClose: vi.fn(),
  execute: vi.fn(), model: vi.fn(),
}));
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: mocks.create }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class { close = mocks.transportClose; },
}));
vi.mock("./ai-provider", () => ({ getLanguageModel: mocks.model }));

import { createPxPrompt, PxProvider } from "./px";
import { selectImageRepresentations } from "./image-references";

const uri = "nap://test/character/captain";
const manifest = { id: uri, name: "Captain", entity_type: "character" };
const entity = { ...manifest, type: "character" };
const request = {
  channelId: "test", inputQuery: uri, chronologicalBlocks: [], loreAtoms: [],
  representationProperties: [], maxUniqueEntityRepresentations: 5,
};
const inputSchema = z.object({ uri: z.string(), branch: z.string().optional() });
const enrich = () => new PxProvider({ loadSkill: async () => "# NAP skill" }).enrichContext(request);

function result(content: LanguageModelV4GenerateResult["content"], reason: "stop" | "tool-calls" = "stop"): LanguageModelV4GenerateResult {
  return {
    content, finishReason: { unified: reason, raw: undefined }, warnings: [],
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
  };
}
const call = () => result([{
  type: "tool-call", toolCallId: "resolve-1", toolName: "nap_resolve",
  input: JSON.stringify({ uri, branch: "main" }),
}], "tool-calls");
const answer = (text = JSON.stringify({ entities: [entity] })) => result([{ type: "text", text }]);
function modelWith(responses: LanguageModelV4GenerateResult[]) {
  const model = new MockLanguageModelV4({ doGenerate: responses });
  mocks.model.mockReturnValue(model);
  return model;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue({ listTools: mocks.list, toolsFromDefinitions: mocks.tools, close: mocks.close });
  mocks.list.mockResolvedValue({ tools: [
    { name: "nap_set", inputSchema: { type: "object" } },
    { name: "nap_resolve", inputSchema: z.toJSONSchema(inputSchema) },
  ] });
  mocks.tools.mockReturnValue({
    nap_resolve: { inputSchema, description: "Resolve manifest", execute: mocks.execute },
    nap_set: { inputSchema, execute: vi.fn() },
  });
  mocks.execute.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(manifest) }] });
  modelWith([call(), answer()]);
});
afterEach(() => vi.restoreAllMocks());

describe("PX MCP integration with the real AI SDK loop", () => {
  it("exposes only nap_resolve and feeds its result into the final structured generation", async () => {
    const model = modelWith([call(), answer()]);
    expect(await enrich()).toEqual({ entities: [entity] });
    expect(model.doGenerateCalls).toHaveLength(2);
    for (const args of model.doGenerateCalls) {
      expect(args.tools?.map(tool => tool.name)).toEqual(["nap_resolve"]);
      expect(args.tools?.[0]).toMatchObject({ inputSchema: { required: ["uri"] } });
    }
    expect(model.doGenerateCalls[1].prompt).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "tool", content: expect.arrayContaining([
        expect.objectContaining({ type: "tool-result", toolName: "nap_resolve" }),
      ]) }),
    ]));
    expect(mocks.execute).toHaveBeenCalledWith({ uri, format: "json" }, expect.anything());
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.tools).toHaveBeenCalledWith({ tools: [expect.objectContaining({ name: "nap_resolve" })] });
  });

  it("does not connect during construction", () => {
    new PxProvider();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("reports a missing tool and closes the client", async () => {
    mocks.tools.mockReturnValue({});
    await expect(enrich()).rejects.toThrow("PX MCP tool discovery failed: The MCP server does not expose an executable nap_resolve tool.");
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("preserves connection errors and closes a partially started transport", async () => {
    const cause = new Error("spawn failed");
    mocks.create.mockRejectedValue(cause);
    await expect(enrich()).rejects.toMatchObject({ message: "PX MCP connection failed: spawn failed", cause });
    expect(mocks.transportClose).toHaveBeenCalledOnce();
  });

  it("preserves discovery errors", async () => {
    const cause = new Error("list failed");
    mocks.list.mockRejectedValue(cause);
    await expect(enrich()).rejects.toMatchObject({ message: "PX MCP tool discovery failed: list failed", cause });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each(["MCP error", "exception"])("stops after a resolution %s without accepting fabricated output", async kind => {
    const cause = new Error("Lore state unreadable");
    const model = modelWith([call(), answer()]);
    if (kind === "MCP error") {
      mocks.execute.mockResolvedValue({ isError: true, content: [{ type: "text", text: cause.message }] });
    } else mocks.execute.mockRejectedValue(cause);
    await expect(enrich()).rejects.toThrow(`PX nap_resolve resolution for ${uri} failed: Lore state unreadable`);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("stops after invalid tool arguments", async () => {
    const invalidCall = call();
    invalidCall.content = [{ type: "tool-call", toolName: "nap_resolve", toolCallId: "bad", input: "{}" }];
    const model = modelWith([invalidCall, answer()]);
    await expect(enrich()).rejects.toThrow("PX nap_resolve resolution failed:");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("reports exhaustion with step count and preserves the missing-output exception", async () => {
    const model = modelWith(Array.from({ length: 10 }, call));
    const error = await enrich().catch(error => error);
    expect(error.message).toContain("Finish reason: tool-calls; steps: 10 (limit 10)");
    expect(error.cause.cause.name).toBe("AI_NoOutputGeneratedError");
    expect(model.doGenerateCalls).toHaveLength(10);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each(["not json", '{"entities":[{"id":1}]}'])("reports invalid structured output: %s", async text => {
    modelWith([call(), answer(text)]);
    await expect(enrich()).rejects.toThrow("PX schema validation failed:");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("preserves model generation failures", async () => {
    const cause = new Error("provider unavailable");
    mocks.model.mockReturnValue(new MockLanguageModelV4({ doGenerate: async () => { throw cause; } }));
    await expect(enrich()).rejects.toMatchObject({ message: "PX generation failed: provider unavailable", cause });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("does not replace the primary error when cleanup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.execute.mockRejectedValue(new Error("original resolution failure"));
    mocks.close.mockRejectedValue(new Error("cleanup failure"));
    await expect(enrich()).rejects.toThrow("original resolution failure");
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ message: "PX MCP cleanup failed: cleanup failure" }));
  });

  it("reports cleanup failure when enrichment otherwise succeeded", async () => {
    mocks.close.mockRejectedValue(new Error("cleanup failure"));
    await expect(enrich()).rejects.toThrow("PX MCP cleanup failed: cleanup failure");
  });

  it("clarifies the required-entity exception and known-URI guidance", async () => {
    expect(createPxPrompt(request, [uri])).toContain("Required entities are an exception");
    const model = modelWith([answer('{"entities":[]}')]);
    await enrich();
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("Skip entities without a known URI");
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("default revision");
  });
});

// Match the actual NAP wire shape, not a model-generated NarrativeEntity.
const claire = {
  id: "nap://25th-chapter/character/claire-cole",
  name: "Claire Cole", entity_type: "character", version: 6,
  properties: {
    bio: "Claire Cole is a major crimes detective whose career was built on noticing the detail everyone else dismisses. Direct, intuitive, and unafraid to distrust an official narrative, she recognizes that the case is leaving clues designed to be seen—but not explained. Her partnership with Nathan asks her to turn instinct into proof before the conspiracy closes around them.",
    investigation_arc: "Evidence that defies explanation becomes the one pattern she refuses to ignore.",
    role: "Major crimes detective", traits: "Perceptive, direct, intuitive, tenacious.",
  },
  representations: { portrait: {
    hash: "blake3:0bd96a9a3691f35d8c9f89c2c2b68716075166b8bedb38eb2c285803dd9cd85a",
    format: "png", uri: "portrait.png",
  } },
  references: {},
};
const profileProvider = () => new PxProvider({
  loadSkill: async () => "# NAP skill",
  requiredEntitiesByChannel: { "25th-chapter": [claire.id] },
});
const storyRequest = {
  ...request, channelId: "25th-chapter", inputQuery: "Continue Claire's investigation.",
  chronologicalBlocks: [{ id: 1, index: 1, happenedAt: 1, content: "Claire arrived." }],
  loreAtoms: [{ id: 1, happenedAt: 1, content: "Claire is a detective." }],
};

describe("canonical NAP profiles", () => {
  beforeEach(() => {
    mocks.execute.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(claire) }] });
  });

  it("resolves required profiles with existing story data even if the model calls no tools", async () => {
    const model = modelWith([answer('{"entities":[]}')]);
    const output = await profileProvider().enrichContext(storyRequest);
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledWith(
      { uri: claire.id, format: "json" }, expect.anything(),
    );
    expect(model.doGenerateCalls[0].prompt[0]).toBeDefined();
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain(claire.id);
    expect(output.entities).toEqual([{ ...claire, type: "character" }]);
    expect(selectImageRepresentations(output.entities!, ["portrait"], 5)).toEqual([
      expect.objectContaining({ entityId: claire.id, representationKey: "portrait", ...claire.representations.portrait }),
    ]);
  });

  it("preserves the full manifest instead of the model's abbreviated or fabricated profile", async () => {
    modelWith([answer(JSON.stringify({ entities: [
      { id: claire.id, name: "Wrong name", type: "wrong type", properties: { bio: "Wrong biography" } },
      { id: "nap://25th-chapter/character/invented", name: "Invented", type: "character" },
    ] }))]);
    expect((await profileProvider().enrichContext(storyRequest)).entities)
      .toEqual([{ ...claire, type: "character" }]);
  });

  it("uses structuredContent when the server supplies it", async () => {
    mocks.execute.mockResolvedValue({ structuredContent: claire, content: [] });
    modelWith([answer('{}')]);
    expect((await profileProvider().enrichContext(storyRequest)).entities)
      .toEqual([{ ...claire, type: "character" }]);
  });

  it.each([
    { content: [{ type: "text", text: "not JSON" }] },
    { content: [{ type: "text", text: JSON.stringify({ ...claire, entity_type: undefined }) }] },
    { content: [{ type: "text", text: JSON.stringify({ ...claire, id: "nap://wrong/character/other" }) }] },
  ])("rejects a malformed or mismatched manifest", async response => {
    mocks.execute.mockResolvedValue(response);
    await expect(profileProvider().enrichContext(storyRequest)).rejects.toThrow(`PX nap_resolve resolution for ${claire.id} failed:`);
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("does not hide required-entity failures behind an empty model response", async () => {
    mocks.execute.mockResolvedValue({ isError: true, content: [{ type: "text", text: "CLI_ERROR: unreadable state" }] });
    await expect(profileProvider().enrichContext(storyRequest)).rejects.toThrow("CLI_ERROR: unreadable state");
    expect(mocks.model).not.toHaveBeenCalled();
  });

  it("deduplicates configured profiles and repeated model tool calls", async () => {
    const toolCall = result([{
      type: "tool-call", toolName: "nap_resolve", toolCallId: "again", input: JSON.stringify({ uri: claire.id }),
    }], "tool-calls");
    modelWith([toolCall, answer('{}')]);
    const provider = new PxProvider({ loadSkill: async () => "skill", requiredEntitiesByChannel: { "25th-chapter": [claire.id, claire.id] } });
    expect((await provider.enrichContext(storyRequest)).entities).toHaveLength(1);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("returns no entities and starts no MCP process when the limit is zero", async () => {
    expect(await profileProvider().enrichContext({ ...storyRequest, maxUniqueEntityRepresentations: 0 }))
      .toEqual({ entities: [] });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("enforces the entity limit across distinct tool calls", async () => {
    const secondCall = result([{
      type: "tool-call", toolName: "nap_resolve", toolCallId: "other", input: JSON.stringify({ uri }),
    }], "tool-calls");
    modelWith([secondCall]);
    await expect(profileProvider().enrichContext({ ...storyRequest, maxUniqueEntityRepresentations: 1 }))
      .rejects.toThrow("Entity resolution limit (1) exceeded");
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});


describe("MCP diagnostics and deadlines", () => {
  it("accepts a canonical JSON manifest surrounded by CLI log lines", async () => {
    const withNestedId = { ...claire, references: { partner: { id: "nap://test/character/partner" } } };
    const text = '\u001b[33m WARN lore command took > 5s\u001b[0m\n' + JSON.stringify(withNestedId, null, 2) + '\nINFO done';
    mocks.execute.mockResolvedValue({ content: [{ type: "text", text }] });
    modelWith([answer('{}')]);
    expect((await profileProvider().enrichContext(storyRequest)).entities)
      .toEqual([{ ...withNestedId, type: "character" }]);
  });

  it("rejects ambiguous log-prefixed responses with multiple manifests", async () => {
    const text = 'WARN slow\n' + JSON.stringify(claire) + '\n' + JSON.stringify(claire);
    mocks.execute.mockResolvedValue({ content: [{ type: "text", text }] });
    await expect(profileProvider().enrichContext(storyRequest)).rejects.toThrow("multiple manifest objects");
  });

  it("finds nap_resolve on a later discovery page", async () => {
    mocks.list.mockResolvedValueOnce({ tools: [], nextCursor: "next-page" });
    await enrich();
    expect(mocks.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ params: { cursor: "next-page" } }));
  });

  it("aborts discovery at the PX deadline and cleans up", async () => {
    vi.useFakeTimers();
    try {
      mocks.list.mockImplementation(({ options }) => new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      }));
      const pending = enrich();
      const assertion = expect(pending).rejects.toThrow("PX enrichment timeout (>45000ms)");
      await vi.advanceTimersByTimeAsync(45_000);
      await assertion;
      expect(mocks.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

// Opt-in read-only smoke test. Ordinary unit tests never start a NAP process.
it.skipIf(process.env.NAP_MCP_SMOKE !== "1")("preserves a live Claire manifest when the model returns no profile", async () => {
  const actualMcp = await vi.importActual<typeof import("@ai-sdk/mcp")>("@ai-sdk/mcp");
  const actualStdio = await vi.importActual<typeof import("@modelcontextprotocol/sdk/client/stdio.js")>("@modelcontextprotocol/sdk/client/stdio.js");
  mocks.create.mockImplementation(config => actualMcp.createMCPClient({
    ...config,
    transport: new actualStdio.StdioClientTransport({ command: "/bin/sh", args: ["-lc", "exec nap-mcp-server"] }),
  }));
  modelWith([answer('{"entities":[]}')]);
  const output = await profileProvider().enrichContext(storyRequest);
  expect(output.entities).toHaveLength(1);
  expect(output.entities?.[0]).toMatchObject({
    id: claire.id, name: claire.name, entity_type: "character", type: "character",
    properties: { bio: expect.stringContaining("major crimes detective") },
    representations: { portrait: { hash: expect.stringMatching(/^blake3:/), format: "png", uri: "portrait.png" } },
  });
  expect(selectImageRepresentations(output.entities!, ["portrait"], 5)).toHaveLength(1);
}, 50_000);
