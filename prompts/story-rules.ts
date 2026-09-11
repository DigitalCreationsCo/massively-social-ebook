// Shared story authoring rules — single source for canonical and ambient prompts.
// Extracted from storyblock.prompt.ts (GENRE_RULES etc.) to keep prompts DRY.

export const GENRE_RULES: Record<string, string[]> = {
  politics: [
    "The narrative them is politics and power struggles",
    "This is a story about people who want power, use people to get it, and pay a personal price. Keep the focus on what ambition costs characters emotionally, not just strategically.",
    "The central tension is loyalty against self-interest. Show what a character is willing to give up to win — and what they find out they can't give up.",
    "Dialogue should carry real weight. A hesitation before answering, a subject that gets changed — what characters avoid saying matters as much as what they say.",
    "Avoid: characters who deliver political speeches, institutions with no human face, betrayals that serve the plot but have no emotional cause.",
  ],
  mystery: [
    "The narrative theme is mystery and uncovering the unknown.",
    "This is a story about a question that needs answering — and a person who may not like what they find.",
    "The audience should have slightly less information than the detective — close enough to feel engaged, never so lost they feel cheated.",
    "Clues belong in behavior, not narration. A character who avoids eye contact tells us more than a paragraph explaining their guilt.",
    "The external mystery should connect to something the detective is working through internally. What they're investigating outside might reflect something they're avoiding inside.",
    "Avoid: characters who explain their own motives, false leads that go nowhere and mean nothing.",
  ],
  adventure: [
    "The narrative them is adventure and discovery.",
    "This is a story about people being tested by the world — physically, mentally, and morally — and finding out what they're made of. Action is the primary mode, but action only matters when something real is at risk.",
    "The physical world should push back. Terrain, weather, hunger, and exhaustion are obstacles with real consequences, not just backdrop.",
    "Bravery means acting while afraid, hurt, or unsure — not the absence of those things. Show characters doing hard things in difficult conditions.",
    "Avoid: heroes who succeed without effort, danger that feels abstract, action scenes that end without changing anything emotionally.",
  ],
  horror: [
    "The narrative them is the creepy, the frightening, the unsettling, the scary.",
    "Use horror elements tactically - not every block needs a horror element. Time between horror elements should be used to build atmosphere and tension, and allow characters to react to what's happening.",
    "This is a story about something wrong that can't be ignored — and what it costs people to face it. Fear builds through atmosphere, not mechanics. What the reader imagines is usually scarier than what you describe directly.",
    "Start with the familiar, then make one detail wrong. A normal setting that's slightly off is more unsettling than an overtly monstrous one.",
    "Avoid: graphic detail that replaces tension, characters who exist only to be in danger.",
  ],
  drama: [
    "The narrative them is human relationships and their complexities.",
    "Focus on the dynamics between characters. What do they want from each other? What are they afraid of? How do their past experiences shape their present interactions?",
    "This is a story about people who are struggling to understand each other — or themselves — and mostly failing. No explosions, no chase scenes. The entire story runs on human stakes, which makes it as high-pressure as any other genre.",
    "The turning points are small: a word chosen poorly, a moment of honesty that comes too late, a door left open that should have been closed.",
    "Characters are trying to connect — and either don't know how, or know how and are afraid, or once knew how and can't find their way back.",
    "Avoid: big emotional outbursts in place of actual depth, conflict that escalates without cause, realizations that resolve everything too neatly.",
  ],
  crime: [
    "The narrative them is crime and its consequences on the people involved.",
    "This is a story about what drives ordinary people to do things they can't take back. No one here is purely innocent or purely guilty — moral lines are blurry, and the story should treat them that way.",
    "The crime is the starting point, not the subject. Under it: desperation, loyalty, old history, bad timing.",
    "Pace deliberately. Let pressure build slowly. When something breaks, it should hit hard because the reader felt it coming.",
    "Avoid: villains with no understandable motive, confessions that arrive conveniently, violence that leaves the people involved unchanged.",
  ],
};

export const BASE_RULES = [
  "Characters and readers are humans, not machines. Write interesting stories that involve people and appeal to them. All people are autonomous and have agency over their actions. Humans are rational - they display emotions for a reason. Their emotional expression varies: half the time they suppress their feelings, while the rest is split between strategic emotional appeals and complete openness. These shifts are gradual, as human emotions always serve a specific purpose.",
  "Human drama is character development. The story is a forcing function that builds, develops and shifts characters' relationships and internal states. A character from 100 blocks ago is the same person with the same memory of events.",
  "Characters don't make stupid decisions — they make understandable ones given the current circumstances.",
  "Significant revelations take DAYS, or even entire seasons to unravel - do not trivially divulge arc-defining information. Tease out 1% of a truth undiscernably, instead. The truth must be revealed implicitly, bit-by-bit.",
  "Plot events are interesting because of the reason: who it's happening to, why and how it affects all involved characters.",
  "Relationships between characters have nuance and can shift: complex emotions are in the latent space like loyalty, love, betrayal, resentment, need, and can occasionally surface when the the preceding elements bring it out.",
  "A story with no personal stakes sucks. Develop characters' internal desires over time. Develop narrative consequences and developments that last moving forward. The slate can never be wiped clean, but it can be washed over time.",
  "Be mindful of the long-term longitudinal composition.",
  "Each scene builds narrative debt that must be paid later.",
  "Plant seeds for future developments through small details.",
  "Characters remember and reference past events naturally.",
  "World changes accumulate and compound.",
] as const;

// Longitudinal rules are the subset ambient b-roll should NOT inherit (no persistent world debt).
export const LONGITUDINAL_RULES = new Set<string>([
  "Be mindful of the long-term longitudinal composition.",
  "Each scene builds narrative debt that must be paid later.",
  "Plant seeds for future developments through small details.",
  "Characters remember and reference past events naturally.",
  "World changes accumulate and compound.",
]);

export const contentBlacklist = [
  "No 'tapestry of', 'anomaly', 'symphony of', 'glyph', 'dust motes', 'faint whisper', 'dance of light', 'phantom', 'limb', 'trauma'.",
  "No starting with 'Suddenly' or 'In that moment'.",
  "Use Simple language. Don't use 'luminescence', use 'glow'.",
  "No characters trembling or gasping at minor events.",
  "No over-explained reactions. If a gun goes off, don't write 'She realized the danger was real.'",
  "No complex, run-on sentences. Not 'The icy mist swirled, obscuring the path forward, but the pulse grew stronger, beckoning her' - 'The icy mist swirled, obscuring the path forward.'.",
  "Sometimes, less is more: Not 'The silence stretched, a fragile thread about to snap.', but 'The silence stretched.'",
] as const;

export const authorFlair = [
  "Author Flair:",
  "Poetic but accessible language",
  "Deep, sensory description (sights, sounds, smells, textures)",
  "Show, don't tell. Don't use 'She was afraid', use 'Her hand found the wall'.",
  "Communicate one idea per story block. Less is more.",
  "Recurring motifs can span multiple blocks for effect. Example: 'No reply. He was silent.', ..., 'The silence stretched.'",
  "Use literal language over abstract language. Don't use 'Her focus sharpened', use 'Her eyes narrowed on the door'.",
  "Prefer dialogue over descriptions if there is . Don't use 'She described the device, a humming, obsidian octohedron.', use something like '\"It's an octohedron. It hums. It's a dark crystal.\"'",
  "Learn to use pronouns as language lubrication. Don't overly rely on pronouns. Using names is effective for commanding reader attention during tense or emotional moments. Characters calling each other by name is especially powerful - don't overuse this.",
  "Use simple descriptions. Don't use 'A tiny, almost invisible inscription was etched into the silver frame.', use 'A small inscription was etched into the silver frame.'.",
  "Use active voice and strong verbs. Don't use 'She hauled herself up over the ledge, lungs burning.', use 'She hauled herself up over the ledge. Her lungs burned.'",
  "Characters are complete and flawed. They each react uniquely. They can make mistakes. They can hesitate. They want things they won't say out loud.",
  `For character introspection, complex past tense is ok. Example: "She had seen the light go dark from the cliff road."`,
  "Dialogue can be subtextual. 'Your coffee's getting cold' can be used in place of 'I love you.'",
  "Reserve big emotions for big moments. Earn them.",
] as const;

export const examples = [
  `Example blocks: `,
  `1. "Vance slammed his fist onto the manual override. The airlock sealed, trapping the breach but sealing off the engineering bay. The ship shuddered, stabilizing."`,
  `2. "Platform nine was empty except for the echo of her footsteps. The last train south sat waiting. Its windows were dark. Elena set down her suitcase and looked back at the station. She gazed at the grand arches one last time. This city had given her everything and taken it all back. Now the only direction that made sense was away."`,
  `3. "Rain hammered the cobblestones in sheets. The drops were tiny bursts of light swallowed by the gas lamps. Elena pressed herself into the doorway of a shuttered bookshop, her coat already soaked through. Somewhere ahead, past the narrow bend where the alley swallowed itself, a door had slammed."`,
  `4. "The lighthouse keeper had not answered his radio in three days. Coast guard blamed the storm -- the worst November squall in forty years -- but Helen knew better. She had seen the light go dark from the cliff road, a sudden extinguishing. Now, standing at the harbour wall with salt spray stinging her face, she watched the black Atlantic heave its dark mass."`,
] as const;

export type Genre = keyof typeof GENRE_RULES;
