import {
  GENRE_RULES,
  BASE_RULES,
  LONGITUDINAL_RULES,
  contentBlacklist,
  authorFlair,
  examples,
  type Genre,
} from "./story-rules";

// Ambient B-roll is slice-of-life, low-stakes, high-atmosphere.
// Reuse genre tone but override stakes — a mystery café linger vs mystery chase.

const AMBIENT_BASE_RULES = BASE_RULES.filter((r) => !LONGITUDINAL_RULES.has(r));

// Ambient keeps gentle atmospheric examples (drops airlock breach, keeps platform/rain/lighthouse)
const ambientExamples = [
  examples[0], // header
  examples[2], // Platform nine — quiet departure
  examples[3], // Rain hammered cobblestones — atmosphere
] as const;

export type AmbientPromptOptions = {
  worldProse?: string;
  previousAmbient?: string; // 1-2 block tail, ephemeral continuity only
  genre?: Genre;
};

/** User prompt for ambient b-roll — world-grounded, not canonical-chain-grounded. */
export const createAmbientContextPrompt = ({
  worldProse,
  previousAmbient,
}: AmbientPromptOptions): string => {
  const sections: string[] = [];

  if (worldProse) sections.push(`World:\n${worldProse}`);

  if (previousAmbient?.trim()) {
    sections.push(`Current b-roll moment:\n${previousAmbient.trim()}`);
  } else {
    sections.push(
      `Open a fresh b-roll vignette in this world. Pick a familiar location from World and a small everyday moment between characters who know it.`,
    );
  }

  return sections.join("\n\n");
};

/** System instructions for ambient b-roll — preserves genre via GENRE_RULES but clamps stakes. */
export const createAmbientSystemInstructions = ({
  genre = "mystery",
}: Pick<AmbientPromptOptions, "genre"> = {}): string => {
  const storyRules = GENRE_RULES[genre] ?? GENRE_RULES.drama;

  return [
    "You are writing disposable B-ROLL for a live channel — not the canonical story. Think interstitial slice-of-life: a café at mid-morning, a hallway after class, a quiet evening at a familiar spot. Low stakes, high atmosphere.",
    "This b-roll is not canonical. Do not advance the main plot, resolve cliffhangers, kill characters, or permanently change relationships, status, or world state. What happens here is a gentle vignette that could have happened between canonical episodes.",
    "Use only the supplied World characters and locations. Do not invent new canon, new factions, or new geography. A familiar location and small talk beat a new revelation.",
    "Every block must feel like the next few minutes after the previous b-roll block in this reel (ephemeral continuity). Do not reset to the same opener. Vary action, dialogue focus, and sensorium across blocks.",
    "You MAY peripherally evoke canonical characters, places, or events as background color (a name on a menu, a memory over coffee) if they appear in World lore — but only as passing texture, never as the scene's hinge. The audience may chat about canonical lore; honor it lightly and do not contradict it, but do not pivot the scene to service it.",
    "No decision branches. No optionA/optionB. No voting setup.",
    ...storyRules,
    // Slice-of-life stakes override — sits after genre so it modulates rather than erases genre
    "Slice-of-life override: even in mystery / horror / crime, keep ambient tension at 'ambient hum' — hints, texture, and mood, not reveals, chases, interrogations, or confrontations. Save plot turns for canonical episodes. Let a question linger rather than be answered here.",
    ...AMBIENT_BASE_RULES,
    ...authorFlair,
    "Close with a soft, lingering image — not a cliffhanger. Let the moment breathe.",
    `Format: [establishment] [evolution] [inspection] — gentle stakes.`,
    "Max 35 words.",
    ...ambientExamples,
    ...contentBlacklist,
  ].join("\n");
};
