import { describe, expect, it } from "vitest";

import {
  createStoryBlockContextPrompt,
  createStoryBlockSystemInstructions,
} from "../../prompts/storyblock.prompt";

describe("story block prompts", () => {
  it("puts live story state only in the context prompt", () => {
    const prompt = createStoryBlockContextPrompt({
      previousBlock: "Mara opened the letter.",
      ragContext: "Three storyblocks ago, Mara found the seal.",
      summary: "Mara is tracing her father's disappearance.",
      lore: ["The seal belongs to the Ashfall family."],
    });

    expect(prompt).toContain("Story summary:");
    expect(prompt).toContain("Established lore:");
    expect(prompt).toContain("Current story context:");
    expect(prompt).toContain("Three storyblocks ago");
    expect(prompt).not.toContain("Characters don't make stupid decisions");
  });

  it("puts durable story rules and choice requirements in the system instruction", () => {
    const instructions = createStoryBlockSystemInstructions({
      genre: "mystery",
      isResolving: false,
      publicChoicesEnabled: true,
    });

    expect(instructions).toContain("The narrative theme is mystery");
    expect(instructions).toContain("Characters don't make stupid decisions");
    expect(instructions).toContain("generate 2 choices");
    expect(instructions).not.toContain("Mara opened the letter");
  });
});
