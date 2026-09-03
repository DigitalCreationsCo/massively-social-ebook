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

import { createPxPrompt, PxProvider } from "./px";

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

  it("does not instruct PX to ignore representationProperties", async () => {
    mockGenerateText.mockResolvedValueOnce({ output: { entities: [] } });
    const provider = new PxProvider({ loadSkill: async () => "# PX Skill" });

    await provider.enrichContext({
      channelId: "test-channel",
      inputQuery: "q",
      chronologicalBlocks: [],
      loreAtoms: [],
      representationProperties: ["reference_image", "portrait"],
      maxUniqueEntityRepresentations: 3,
    });

    const prompt = mockGenerateText.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("Ignore the representationProperties field");
    expect(prompt).toContain("reference_image");
    expect(prompt).toContain("nested representations");
  });

  it("builds preference guidance when no properties are configured", () => {
    const prompt = createPxPrompt({
      channelId: "chan",
      inputQuery: "q",
      chronologicalBlocks: [],
      loreAtoms: [],
      representationProperties: [],
      maxUniqueEntityRepresentations: 5,
    });
    expect(prompt).not.toContain("Ignore the representationProperties");
    expect(prompt).toContain("nested representations");
  });

  describe("PxProvider with required entities", () => {
    it("uses required entities when context is empty", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: {
          entities: [
            { id: "nap://test/entity1", name: "Entity1", type: "character" },
            { id: "nap://test/entity2", name: "Entity2", type: "location" }
          ]
        }
      });
      
      const provider = new PxProvider({
        loadSkill: async () => "# PX Skill",
        requiredEntitiesByChannel: {
          "test-channel": ["nap://test/entity1", "nap://test/entity2"]
        }
      });
      
      const result = await provider.enrichContext({
        channelId: "test-channel",
        inputQuery: "",
        chronologicalBlocks: [],
        loreAtoms: [],
        representationProperties: [],
        maxUniqueEntityRepresentations: 5,
      });
      
      // Verify that required entities were included in the prompt
      const prompt = mockGenerateText.mock.calls[0][0].prompt as string;
      expect(prompt).toContain("Required entities");
      expect(prompt).toContain("nap://test/entity1");
      expect(prompt).toContain("nap://test/entity2");
      expect(result.entities).toHaveLength(2);
    });

    it("does not use required entities when context has data", async () => {
      mockGenerateText.mockResolvedValueOnce({ output: { entities: [] } });
      
      const provider = new PxProvider({
        loadSkill: async () => "# PX Skill",
        requiredEntitiesByChannel: {
          "test-channel": ["nap://test/entity1"]
        }
      });
      
      await provider.enrichContext({
        channelId: "test-channel",
        inputQuery: "Continue the story",
        chronologicalBlocks: [{ content: "Existing story content" }],
        loreAtoms: [],
        representationProperties: [],
        maxUniqueEntityRepresentations: 5,
      });
      
      // Should not include required entities in prompt
      const prompt = mockGenerateText.mock.calls[0][0].prompt as string;
      expect(prompt).not.toContain("Required entities");
    });

    it("deduplicates entities in response", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: {
          entities: [
            { id: "nap://test/entity1", name: "Entity1", type: "character" },
            { id: "nap://test/entity1", name: "Entity1", type: "character" }, // Duplicate
            { id: "nap://test/entity2", name: "Entity2", type: "location" }
          ]
        }
      });
      
      const provider = new PxProvider({ loadSkill: async () => "# PX Skill" });
      
      const result = await provider.enrichContext({
        channelId: "test-channel",
        inputQuery: "",
        chronologicalBlocks: [],
        loreAtoms: [],
        representationProperties: [],
        maxUniqueEntityRepresentations: 5,
      });
      
      expect(result.entities).toHaveLength(2); // Should deduplicate to 2 unique entities
    });
  });

  describe("PxProvider entity ID serialization", () => {
    it("handles entity IDs with special characters correctly", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: {
          entities: [
            { id: "nap://test/character/hero-with-dash", name: "Hero", type: "character" },
            { id: "nap://test/location/space_station_42", name: "Space Station", type: "location" },
            { id: "nap://test/prop/aliens-ship:mark2", name: "Alien Ship", type: "prop" },
            { id: "nap://test/entity/with%20spaces", name: "Entity with Spaces", type: "character" },
            { id: "nap://test/entity/with/slashes/in/path", name: "Deep Path Entity", type: "location" }
          ]
        }
      });
      
      const provider = new PxProvider({ loadSkill: async () => "# PX Skill" });
      
      const result = await provider.enrichContext({
        channelId: "test-channel",
        inputQuery: "",
        chronologicalBlocks: [],
        loreAtoms: [],
        representationProperties: [],
        maxUniqueEntityRepresentations: 10,
      });
      
      // Verify all entity IDs are preserved exactly as returned
      expect(result.entities).toHaveLength(5);
      expect(result.entities?.[0].id).toBe("nap://test/character/hero-with-dash");
      expect(result.entities?.[1].id).toBe("nap://test/location/space_station_42");
      expect(result.entities?.[2].id).toBe("nap://test/prop/aliens-ship:mark2");
      expect(result.entities?.[3].id).toBe("nap://test/entity/with%20spaces");
      expect(result.entities?.[4].id).toBe("nap://test/entity/with/slashes/in/path");
    });

    it("handles entity IDs with Unicode characters correctly", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: {
          entities: [
            { id: "nap://test/character/日本語-ヒーロー", name: "Japanese Hero", type: "character" },
            { id: "nap://test/location/موقع-العربية", name: "Arabic Location", type: "location" },
            { id: "nap://test/entity/émoji-😀-character", name: "Emoji Entity", type: "character" }
          ]
        }
      });
      
      const provider = new PxProvider({ loadSkill: async () => "# PX Skill" });
      
      const result = await provider.enrichContext({
        channelId: "test-channel",
        inputQuery: "",
        chronologicalBlocks: [],
        loreAtoms: [],
        representationProperties: [],
        maxUniqueEntityRepresentations: 10,
      });
      
      // Verify Unicode entity IDs are preserved correctly
      expect(result.entities).toHaveLength(3);
      expect(result.entities?.[0].id).toBe("nap://test/character/日本語-ヒーロー");
      expect(result.entities?.[1].id).toBe("nap://test/location/موقع-العربية");
      expect(result.entities?.[2].id).toBe("nap://test/entity/émoji-😀-character");
    });

    it("handles complex URI entity IDs with query parameters and fragments", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: {
          entities: [
            { id: "nap://test/entity/complex?version=2&format=detailed", name: "Complex URI Entity", type: "character" },
            { id: "nap://test/entity/fragment#section-1", name: "Fragment Entity", type: "location" },
            { id: "nap://test/entity/both?param=value#fragment", name: "Both Params and Fragment", type: "prop" }
          ]
        }
      });
      
      const provider = new PxProvider({ loadSkill: async () => "# PX Skill" });
      
      const result = await provider.enrichContext({
        channelId: "test-channel",
        inputQuery: "",
        chronologicalBlocks: [],
        loreAtoms: [],
        representationProperties: [],
        maxUniqueEntityRepresentations: 10,
      });
      
      // Verify complex URI structures are preserved
      expect(result.entities).toHaveLength(3);
      expect(result.entities?.[0].id).toBe("nap://test/entity/complex?version=2&format=detailed");
      expect(result.entities?.[1].id).toBe("nap://test/entity/fragment#section-1");
      expect(result.entities?.[2].id).toBe("nap://test/entity/both?param=value#fragment");
    });

    it("deduplicates entities with complex IDs correctly", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: {
          entities: [
            { id: "nap://test/character/hero-with-dash", name: "Hero", type: "character" },
            { id: "nap://test/character/hero-with-dash", name: "Hero Duplicate", type: "character" },
            { id: "nap://test/location/日本語-場所", name: "Japanese Location", type: "location" },
            { id: "nap://test/location/日本語-場所", name: "Japanese Location Duplicate", type: "location" },
            { id: "nap://test/entity/unique?param=1", name: "Unique Entity", type: "prop" }
          ]
        }
      });
      
      const provider = new PxProvider({ loadSkill: async () => "# PX Skill" });
      
      const result = await provider.enrichContext({
        channelId: "test-channel",
        inputQuery: "",
        chronologicalBlocks: [],
        loreAtoms: [],
        representationProperties: [],
        maxUniqueEntityRepresentations: 10,
      });
      
      // Should deduplicate to 3 unique entities despite complex IDs
      expect(result.entities).toHaveLength(3);
      expect(result.entities?.[0].id).toBe("nap://test/character/hero-with-dash");
      expect(result.entities?.[1].id).toBe("nap://test/location/日本語-場所");
      expect(result.entities?.[2].id).toBe("nap://test/entity/unique?param=1");
    });

    it("handles empty and whitespace-only entity IDs gracefully", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: {
          entities: [
            { id: "", name: "Empty ID Entity", type: "character" },
            { id: "   ", name: "Whitespace ID Entity", type: "location" },
            { id: "nap://test/valid-entity", name: "Valid Entity", type: "prop" }
          ]
        }
      });
      
      const provider = new PxProvider({ loadSkill: async () => "# PX Skill" });
      
      const result = await provider.enrichContext({
        channelId: "test-channel",
        inputQuery: "",
        chronologicalBlocks: [],
        loreAtoms: [],
        representationProperties: [],
        maxUniqueEntityRepresentations: 10,
      });
      
      // Should handle empty IDs gracefully (deduplication should work)
      expect(result.entities).toBeDefined();
      // Empty and whitespace IDs should be treated as distinct values
      expect(result.entities?.[0].id).toBe("");
      expect(result.entities?.[1].id).toBe("   ");
      expect(result.entities?.[2].id).toBe("nap://test/valid-entity");
    });

    it("serializes and deserializes entity IDs through JSON.stringify/parse", async () => {
      mockGenerateText.mockResolvedValueOnce({
        output: {
          entities: [
            { 
              id: "nap://test/complex/entity?param=value#fragment", 
              name: "Complex Entity", 
              type: "character",
              properties: { "key": "value" }
            }
          ]
        }
      });
      
      const provider = new PxProvider({ loadSkill: async () => "# PX Skill" });
      
      const result = await provider.enrichContext({
        channelId: "test-channel",
        inputQuery: "",
        chronologicalBlocks: [],
        loreAtoms: [],
        representationProperties: [],
        maxUniqueEntityRepresentations: 10,
      });
      
      // Simulate serialization/deserialization
      const serialized = JSON.stringify(result);
      const deserialized = JSON.parse(serialized);
      
      // Verify entity ID survives round-trip
      expect(deserialized.entities?.[0].id).toBe("nap://test/complex/entity?param=value#fragment");
      expect(deserialized.entities?.[0].name).toBe("Complex Entity");
      expect(deserialized.entities?.[0].type).toBe("character");
    });
  });
});
