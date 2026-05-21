export const createNextNarrativeIncrementPrompt = ({ storyblock }: { storyblock: string; }) => `Read the storyblock, then generate three sentences that continue the story. 10 words total maximum.;
First sentence: [1 word, verb, present tense]
Second sentence: [clarify the action, 3 words]
Third sentence: [ Frame the scene. 3 words ]
Examples:
"Escape. Run to the street. Start of the chase."
"Curious. What does she mean? Lean in an reply."
"Inspect. Turn the page. Read the note.":

${storyblock}`;