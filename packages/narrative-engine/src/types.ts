export interface BaseNarrativeBlock {
    id: string | number;
    index: number;
    content: string;
    happenedAt: number;
    isNotable?: boolean;
}

export interface BaseNarrativeLore {
    id: string | number;
    content: string;
    happenedAt: number;
    isActive?: boolean;
}