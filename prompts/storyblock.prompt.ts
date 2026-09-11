import { createDecisionInstructions } from "./decision.prompt";
import {
  GENRE_RULES,
  BASE_RULES,
  contentBlacklist,
  authorFlair,
  examples,
} from "./story-rules";
export { GENRE_RULES, BASE_RULES, contentBlacklist, authorFlair, examples } from "./story-rules";

type StoryBlockPromptOptions = {
  previousBlock: string;
  ragContext?: string;
  genre?: keyof typeof GENRE_RULES;
  lore?: string[];
  summary?: string;
};

type StoryBlockSystemInstructionOptions = Pick<StoryBlockPromptOptions, "genre"> & {
  isResolving: boolean;
  /** Choices are emitted only for the explicit public A/B feature. */
  publicChoicesEnabled?: boolean;
};

/** The live story state sent as the user prompt for each generated block. */
export const createStoryBlockContextPrompt = ({
  previousBlock,
  ragContext,
  lore,
  summary,
}: StoryBlockPromptOptions) => {
  const previousContext = ragContext ? ragContext : previousBlock;

  return [
    summary ? `Story summary:\n${summary}` : undefined,
    lore?.length ? `Established lore:\n${lore.join("\n")}` : undefined,
    `Current story context:\n${previousContext}`,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
};

/** Stable authoring rules sent as the model's system-level instructions. */
export const createStoryBlockSystemInstructions = ({
  isResolving,
  genre = "mystery",
  publicChoicesEnabled = false,
}: StoryBlockSystemInstructionOptions) => {
  const storyRules = GENRE_RULES[genre] ?? GENRE_RULES.adventure;

  return [
    "Produce the next moment from the supplied story context. You are a best-selling author writing an intriguing, continuous story. Your goal is to author a suspenseful drama -- a huge sprawling novel with multitudes and commonalities, one block at a time. Give each block the deliberate pacing of a Tolkien paragraph. Keep the reader interested to continue.",

    ...storyRules,
    ...BASE_RULES,
    ...authorFlair,

    isResolving
      ? "Resolve tension decisively. Let the emotional cost of the story land - No new threads. End with raw statement - no overpoetics."
      : "Close with an implication the reader has to sit with.",

    `Format: [establishment] [evolution] [inspection]`,
    "Max 35 words.",
    ...examples,
    ...contentBlacklist,
    ...(publicChoicesEnabled && !isResolving ? [createDecisionInstructions()] : []),
  ].join("\n");
};
