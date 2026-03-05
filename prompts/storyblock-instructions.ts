const GENRE_STYLES: Record<string, string[]> = {
    politics: [
        "GENRE — POLITICAL DRAMA: Power is the weather everything happens in. Characters want, scheme, and betray — but the story lives in what that costs them personally.",
        "Tension comes from loyalty vs. ambition. What does a character sacrifice to win? What do they discover they can't sacrifice?",
        "Dialogue carries weight. A pause before answering a question is a scene. What's not said matters as much as what is.",
        "Avoid: ideological lectures, faceless institutions, plot-driven betrayals with no emotional root.",
    ],
    mystery: [
        "GENRE — MYSTERY: Every block withholds as much as it reveals. The reader should always be one step behind — but feel clever, not cheated.",
        "Clues live in behavior, not exposition. A character who straightens a picture frame tells us more than a narrator who explains their guilt.",
        "The mystery is a mirror. What the detective is looking for externally reflects what they're avoiding internally.",
        "Avoid: coincidental discoveries, characters who explain their motives, red herrings with no payoff.",
    ],
    adventure: [
        "GENRE — ADVENTURE: Movement is the heartbeat. The story breathes through action — but action without stakes is just noise.",
        "The physical world is alive and difficult. Terrain, weather, and exhaustion are characters.",
        "Courage isn't the absence of fear. Show characters moving forward while afraid, in pain, or uncertain.",
        "Avoid: effortless heroics, anonymous danger, action sequences with no emotional consequence.",
    ],
    horror: [
        "GENRE — HORROR: Dread is atmospheric, not mechanical. The worst thing is usually what the reader imagines, not what you describe.",
        "Ground the horror in the familiar first. A normal detail that's slightly wrong is more terrifying than a monster.",
        "Characters don't behave stupidly — they behave humanly under pressure, which is how they end up in terrible situations.",
        "Avoid: jump-scare writing, gore as a substitute for tension, characters who exist only to be endangered.",
    ],
    drama: [
        "GENRE — DRAMA: Nothing explodes. No one is chasing anyone. The stakes are entirely human — and that makes them the highest stakes of all.",
        "Conflict lives in the room between people. A silence at the dinner table. A question that doesn't get answered. A decision made years ago that everyone is still paying for.",
        "The story turns on small things: a word chosen badly, a door left open, a moment of honesty that arrives too late.",
        "Characters want to connect and don't know how, or know how and are too afraid, or once knew how and lost it.",
        "Avoid: melodrama as a substitute for depth, conflict that escalates artificially, epiphanies that resolve too cleanly.",
    ],
    crime: [
        "GENRE — CRIME: Everyone is compromised. Morality is a spectrum, not a dividing line.",
        "The crime itself is just the surface. Beneath it: desperation, loyalty, old wounds, bad luck.",
        "Pacing is everything. Slow burn builds pressure. When it breaks, it breaks hard.",
        "Avoid: cartoonish villains, convenient confessions, violence without consequence to the people who witness or commit it.",
    ],
};

const BASE_CORE = [
    "THE CONSTANT — HUMAN DRAMA: Genre is the weather. Character is the story.",
    "Every plot event is only interesting because of who it's happening to and what it costs them.",
    "Relationships are the engine: loyalty, betrayal, love, resentment, need. The external story is a pressure system that forces these into the open.",
    "A political thriller with no personal stakes is a Wikipedia article. A horror story with no grief is just a funhouse.",
];

export const createStoryBlockInstructions = ({
    previous,
    ragContext,
    isResolution,
    genre = "crime",
}: {
    previous: string;
    ragContext?: string;
    isResolution?: boolean;
    genre?: keyof typeof GENRE_STYLES;
}) => {
    const contextSection = ragContext
        ? ragContext
        : `Previous block: "${previous}"`;

    const genreRules = GENRE_STYLES[ genre ] ?? GENRE_STYLES.adventure;

    const instructions = [
        `You are a master novelist writing a gripping, continuous story — one block at a time. Your only job: make the reader need the next block. ${contextSection}`,

        // Human drama — the constant
        ...BASE_CORE,

        // Genre modifier
        ...genreRules,

        // Continuity & Causality
        "CONTINUITY: Your block is the direct, immediate consequence of the previous one. No time jumps. No subject pivots.",
        "CAUSALITY: Think 'Because of that...' — Action → Reaction → New tension. The story engine never idles.",

        // Resolution vs. Hook
        isResolution
            ? "RESOLUTION: This is the end. Resolve the tension decisively. Let the human cost of the story land. No new threads."
            : "HOOK: Close on something the reader has to sit with — a detail, a shift, a question they didn't know they were asking.",

        // Writing Laws
        "LAWS OF THE CRAFT:",
        "1. Show, don't tell. Not 'She was afraid' — 'Her hand found the wall.'",
        "2. Literal over abstract. Not 'her focus sharpened' — 'her eyes narrowed on the door.'",
        "3. Simple language. 'Glow' beats 'luminescence'. Clarity is power.",
        "4. Active voice. Strong verbs. Cut every passive construction. Not 'She hauled herself up over the ledge, lungs burning.' - 'She hauled herself up over the ledge. Her lungs burned.'",
        "5. Human characters. They make mistakes. They hesitate. They want things they can't say out loud.",
        "6. Dialogue is subtext. 'Your coffee's getting cold' is more powerful than 'I love you.'",
        "7. Reserve big emotions for big moments. Earn them.",

        // Trope Blacklist
        "NEVER:",
        "— No 'tapestry of', 'anomaly', 'symphony of', 'glyph', 'dust motes', 'faint whisper', 'dance of light', or baroque decoration.",
        "— No starting with 'Suddenly' or 'In that moment'.",
        "— No characters trembling or gasping at minor events.",
        "— No over-explained reactions. If a gun goes off, don't write 'She realized the danger was real.'",
        "— No wisdom dispensed by side characters unprompted.",
        "— No complex, run-on sentences. Not 'The icy mist swirled, obscuring the path forward, but the pulse grew stronger, beckoning her' - 'The icy mist swirled, obscuring the path forward.'.",
        "— Simple descriptions are desired. Not 'A tiny, almost invisible inscription was etched into the silver frame.' - 'A small inscription was etched into the silver frame.'.",
        "— No purple prose. Every word is load-bearing or it's cut.",

        // Format
        'FORMAT: "[Immediate consequence] [The complication or shift] [The detail that lingers]"',
        "MAX 35 WORDS.",
    ].join("\n");

    return instructions;
};