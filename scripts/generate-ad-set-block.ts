import { createStoryBlockInstructions } from "../prompts/storyblock.prompt";



    const lore = [`Essential facts of the story: The Cold Key is a physical encryption card — it contains the only un-mirrored data of a private offshore bank's collapse. The authorities and drones are tracking down the Cold Key.

    Lily acquired a physical encryption card—the "Cold Key". 

    Lily is a woman in her late 20s with high cheekbones, deep - set expressive emerald eyes, and a sleek blonde bob haircut with a sharp fringe.`];


const ragContext = `Lily is leaning back against the metal door she just breached. Her face is flatteringly lit by cool teal neon light bleeding from the corridor ahead. She is alert, breathing hard, her emerald eyes scanning the new space. She has the data-card tucked into the collar of her dark trench coat. Her silhouette is sharp against the closed door. 

Lily pressed her back against the cold steel.The teal neon glowed across her sharp fringe.She tucked the Cold Key deeper into her collar.Her breath hitched.The corridor behind her remained silent.

A drone hummed in the ventilation shaft. Lily froze, her fingers tightening on the card. The red sensor light swept the floor, inches from her boots. It knew someone had opened the door.`;


const previousBlock = "";


const adSetBlock = createStoryBlockInstructions({
    previousBlock,
    ragContext,
    isResolving: false,
    genre: "mystery",
    lore,
    summary: "",
});

console.log(adSetBlock);