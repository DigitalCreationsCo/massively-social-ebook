import { describe, expect, it } from "vitest";
import { loadStoryGenerationConfig } from "./story-generation-config";

describe("loadStoryGenerationConfig", () => {
  it("defaults both capabilities to disabled", () => {
    expect(loadStoryGenerationConfig({})).toEqual({
      publicChoicesEnabled: false,
      publicChoiceCount: 0,
      publicChoiceEffect: "disabled",
      internalCandidateCount: 0,
    });
  });

  it("treats one public choice as disabled end-to-end", () => {
    expect(loadStoryGenerationConfig({ STORY_DECISION_BRANCHES: "1" })).toMatchObject({
      publicChoicesEnabled: false,
      publicChoiceEffect: "disabled_single_choice",
    });
  });

  it("enables only the existing A/B public contract", () => {
    expect(loadStoryGenerationConfig({ STORY_DECISION_BRANCHES: "2" })).toMatchObject({
      publicChoicesEnabled: true,
      publicChoiceEffect: "a_b",
    });
  });

  it.each(["-1", "3", "two", "2.5"])("rejects invalid public choice value %s", (value) => {
    expect(() => loadStoryGenerationConfig({ STORY_DECISION_BRANCHES: value })).toThrow("STORY_DECISION_BRANCHES");
  });

  it.each(["2", "3", "4"])("allows documented internal candidate value %s", (value) => {
    expect(loadStoryGenerationConfig({ STORY_INTERNAL_CANDIDATES: value }).internalCandidateCount).toBe(Number(value));
  });

  it.each(["1", "5", "-1", "many"])("rejects invalid internal candidate value %s", (value) => {
    expect(() => loadStoryGenerationConfig({ STORY_INTERNAL_CANDIDATES: value })).toThrow("STORY_INTERNAL_CANDIDATES");
  });
});
