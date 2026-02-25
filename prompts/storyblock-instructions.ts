export const createStoryBlockInstructions = ({ previous, ragContext, isResolution }: { previous: string; ragContext?: string; isResolution?: boolean; }) => {
    const contextSection = ragContext
        ? ragContext
        : `Previous: "${previous}"`;

    const instructions = [
        `As a brilliant best-selling novelist, produce a block of sentences of 30 words max to progress the story. ${contextSection}`,
        "Deliberate and slow pace. Each block is its own stanza, related to the previous block, and part of a larger story.",
        isResolution
            ? "THIS IS THE SESSION RESOLUTION. End the story block with an intriguing, high-stakes cliffhanger that leaves readers wanting more. DO NOT provide any user options (optionA, optionB) in your response."
            : "Reader choices are for character actions and reactions. The reader decides the story's direction, your job is to describe the story with great writing.",
        "Use quotes for dialogues sometimes. Keep dialogues short and sweet. Watch-and-waiting atmosphere. The reader stays intrigued.",
        "Writing Rules:",
        "- The main character is the only persistent character. Other characters come and go as needed.",
        "- Don't use complex sentence structures and run-on sentences.",
        "- Don't use big words often.",
        "- Prefer literal word choices over abstract ones. The words should help tell a visual story. (Don't say \"Her focus sharpened\". Say \"Her eyes sharpened\".)",
        'Use this format for your blocks: "[establishment] [evolution] [inspection]"'
    ].join('\n');

    return instructions;
};