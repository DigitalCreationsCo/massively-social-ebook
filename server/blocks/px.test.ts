import { describe, expect, it } from "vitest";
import { createPxPrompt, enrichmentSchema } from "./px";

const request = {
  channelId: "25th-chapter", inputQuery: "Claire investigates.",
  chronologicalBlocks: [], loreAtoms: [], representationProperties: ["portrait"],
  maxUniqueEntityRepresentations: 5,
};

describe("PX prompt and enrichment contract", () => {
  it("provides configured URIs alongside prose and prioritizes required entities", () => {
    const prompt = createPxPrompt(request, ["nap://25th-chapter/character/claire-cole"]);
    expect(prompt).toContain("nap_resolve");
    expect(prompt).toContain("nap://25th-chapter/character/claire-cole");
    expect(prompt).toContain("Required entities are an exception");
    expect(prompt).toContain("Claire investigates.");
  });

  it("retains nested representation guidance and preferences", () => {
    const prompt = createPxPrompt(request);
    expect(prompt).toContain("full nested representations map");
    expect(prompt).toContain("portrait");
    expect(prompt).toContain("Limit queried entities to 5");
  });

  it("provides a default representation preference", () => {
    expect(createPxPrompt({ ...request, representationProperties: [] }))
      .toContain("return the primary representation per entity");
  });

  it("accepts canonical nested properties and representations", () => {
    const entity = {
      id: "nap://test/character/日本語-ヒーロー", name: "Hero", type: "character",
      properties: { traits: ["perceptive"], nested: { active: true } },
      representations: { portrait: { hash: "blake3:abc", format: "png", uri: "portrait.png" } },
    };
    expect(enrichmentSchema.parse({ entities: [entity] })).toEqual({ entities: [entity] });
  });
});
