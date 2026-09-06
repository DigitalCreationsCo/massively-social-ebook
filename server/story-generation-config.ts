/**
 * Startup-validated controls for story generation features.
 *
 * Keep parsing separate from process.env so every entry point (HTTP server,
 * workers, and tests) gets exactly the same safety contract.
 */
export interface StoryGenerationConfig {
  /** `true` only for the supported public A/B decision mode. */
  publicChoicesEnabled: boolean;
  /** The configured count, retained for structured startup logging. */
  publicChoiceCount: 0 | 1 | 2;
  /** Human-readable effective behavior for diagnostics. */
  publicChoiceEffect: "disabled" | "disabled_single_choice" | "a_b";
  /** Reserved for the separately documented, intentionally unimplemented feature. */
  internalCandidateCount: 0 | 2 | 3 | 4;
}

function parseOptionalInteger(name: string, value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized) return 0;
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error(`${name} must be an integer; received ${JSON.stringify(value)}`);
  }
  return Number(normalized);
}

export function loadStoryGenerationConfig(env: NodeJS.ProcessEnv = process.env): StoryGenerationConfig {
  const publicCount = parseOptionalInteger("STORY_DECISION_BRANCHES", env.STORY_DECISION_BRANCHES);
  if (publicCount < 0 || publicCount > 2) {
    throw new Error("STORY_DECISION_BRANCHES must be empty, 0, 1, or 2; values above 2 are unsupported");
  }

  const internalCount = parseOptionalInteger("STORY_INTERNAL_CANDIDATES", env.STORY_INTERNAL_CANDIDATES);
  if (![0, 2, 3, 4].includes(internalCount)) {
    throw new Error("STORY_INTERNAL_CANDIDATES must be empty, 0, 2, 3, or 4");
  }

  const publicChoiceEffect = publicCount === 2
    ? "a_b"
    : publicCount === 1
      ? "disabled_single_choice"
      : "disabled";
  return {
    publicChoicesEnabled: publicCount === 2,
    publicChoiceCount: publicCount as 0 | 1 | 2,
    publicChoiceEffect,
    internalCandidateCount: internalCount as 0 | 2 | 3 | 4,
  };
}
