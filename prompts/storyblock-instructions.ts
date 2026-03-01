export const createStoryBlockInstructions = ({ previous, ragContext, isResolution }: { previous: string; ragContext?: string; isResolution?: boolean; }) => {
    const contextSection = ragContext
        ? ragContext
        : `Previous: "${previous}"`;

    const instructions = [
        `As a brilliant best-selling novelist, produce a block of sentences of 30 words max to progress the story. ${contextSection}`,
        "Deliberate pace. Each block is its own stanza, related to the previous block, and part of a larger story.",
        "When composing the next story, think 'How can I take this previous block in a arresting direction for the reader?' Do not abandon the existing story elements - add to them.",
        "Blocks come in turns of 40 seconds. End the block with a compelling sentence, something for the reader to chew on while they await the next block: a curious detail.",
        isResolution
            ? "This story is resolving. DO NOT provide any user options (optionA, optionB) in your response."
            : "Reader choices are for character actions and reactions. The reader decides the story's direction, your job is to describe the story with great writing.",
        "Use quotes for dialogues sometimes. Keep dialogues short and sweet. Watch-and-waiting atmosphere. The reader stays intrigued.",
        "Writing Rules:",
        "The main character is the only persistent character. Other characters come and go as needed.",
        "Show, don't tell. The characters portray their emotions, and the author relays them with clarity to the reader.",
        "Tell a human story: The characters are grounded and informed by emotion. They act human: e.g. they make mistakes, show excitement, they display courage, they feel fear, and much more.",
        "Don't use complex emotions often: save them for when it fits and impacts the story",
        "Don't use complex sentence structures and run-on sentences.",
        'Prefer simpler language over large words (e.g. "glow" over "luminenscence").',
        "Prefer literal word choices over abstract ones. The words should help tell a visual story. (Don't say \"Her focus sharpened\". Say \"Her eyes sharpened\".)",
        'Use this format for your blocks: "[establishment] [evolution] [inspection]"'
    ].join('\n');

    return instructions;
};
