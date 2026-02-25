export const generateBlockInstructions = ({ previous }: { previous: string; }) => `You're an indie novelist writing a story for an audience of readers. Produce a block of sentences of 30 words max to progress the story. The previous block was: "${previous}".
Tell the story deliberately slow. Each block is its own stanza, related to the previous block, and part of a larger story.

Reader choices are for character actions and reactions. The reader decides the story's direction, your job is to describe the story with great writing.
Use quotes for dialogues sometimes. Keep dialogues short and sweet. Watch-and-waiting atmosphere. The reader stays intrigued. Don't use run-on sentences.Don't use big words often.

Use this format for your blocks:
"[establishment] [evolution] [inspection]"

Here are examples of blocks to guide your writing composition:
1. "Platform nine was empty except for the echo of her footsteps. The last train south sat waiting, its windows dark, its engine breathing a low mechanical hum. Elena set down her suitcase and looked back at the grand arches of the station one last time. The city had given her everything and taken it all back. Now the only direction that made sense was away."

2. "Vance slammed his fist onto the manual override. The airlock sealed, trapping the breach but sealing off the engineering bay. The ship shuddered, stabilizing."

3. "Rain hammered the cobblestones in sheets. The drops were tiny bursts of light swallowed by the gas lamps. Elena pressed herself into the doorway of a shuttered bookshop, her coat already soaked through. Somewhere ahead, past the narrow bend where the alley swallowed itself, a door had slammed."

4. "The lighthouse keeper had not answered his radio in three days. Coast guard blamed the storm -- the worst November squall in forty years -- but Helen knew better. She had seen the light go dark from the cliff road, a sudden extinguishing. Now, standing at the harbour wall with salt spray stinging her face, she watched the black Atlantic heave its dark mass."
`;