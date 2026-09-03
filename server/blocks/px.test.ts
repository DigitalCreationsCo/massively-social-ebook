import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateText, mockGetLanguageModel } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockGetLanguageModel: vi.fn(() => ({ provider: "test" })),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  Output: { object: vi.fn((definition: unknown) => definition) },
}));

vi.mock("./ai-provider", () => ({ getLanguageModel: mockGetLanguageModel }));

import { PxProvider } from "./px";

describe("PxProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes the synchronized skill in the LLM instructions", async () => {
    mockGenerateText.mockResolvedValueOnce({
      output: { entities: [{ id: "captain", name: "Captain", type: "character" }] },
    });
    const provider = new PxProvider({ loadSkill: async () => "# PX Skill\nExtract named entities." });

    const result = await provider.enrichContext({
      channelId: "test-channel",
      inputQuery: "The captain arrived.",
      chronologicalBlocks: [],
      loreAtoms: [],
      representationProperties: [],
      maxUniqueEntityRepresentations: 5,
    });

    expect(mockGetLanguageModel).toHaveBeenCalledOnce();
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      instructions: expect.stringContaining("# PX Skill"),
      prompt: expect.stringContaining("test-channel"),
    }));
    expect(result.entities?.[0]?.name).toBe("Captain");
  });

  it("fails when the LLM does not return a structured enrichment", async () => {
    mockGenerateText.mockResolvedValueOnce({ output: undefined });
    const provider = new PxProvider({ loadSkill: async () => "# PX Skill" });

    await expect(provider.enrichContext({
      channelId: "test-channel",
      inputQuery: "The captain arrived.",
      chronologicalBlocks: [],
      loreAtoms: [],
      representationProperties: [],
      maxUniqueEntityRepresentations: 5,
    })).rejects.toThrow("PX enrichment failed: No structured output returned.");
  });
});
