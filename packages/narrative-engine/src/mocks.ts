import { BaseNarrativeBlock, BaseNarrativeLore } from "./types";

export const MOCK_BLOCKS: BaseNarrativeBlock[] = [
    { "id": 1, "index": 1, "content": "Kael woke up in the cryo-pod with no memory.", "happenedAt": 2000, "isNotable": true },
    { "id": 25, "index": 25, "content": "The ship's AI, ELARA, reported a hull breach in Sector 4.", "happenedAt": 5000, "isNotable": false },
    { "id": 48, "index": 48, "content": "Kael found a strange obsidian cube in the cargo bay.", "happenedAt": 8500, "isNotable": true },
    { "id": 49, "index": 49, "content": "ELARA warns that the cube is emitting a Void signature.", "happenedAt": 8600, "isNotable": false },
    { "id": 50, "index": 50, "content": "Kael reaches for his rebreather as the alarms scream.", "happenedAt": 9000, "isNotable": false }
];

export const MOCK_LORE: BaseNarrativeLore[] = [
    { "id": "lore-1", "content": "The atmosphere on Kepler-186f is toxic without a rebreather.", "happenedAt": 1000, "isActive": true },
    { "id": "lore-2", "content": "Captain Kael has a cybernetic left arm from the Sol Wars.", "happenedAt": 1005, "isActive": true },
    { "id": "lore-3", "content": "The 'Void-Eaters' are attracted to high-energy signatures.", "happenedAt": 1010, "isActive": true }
];