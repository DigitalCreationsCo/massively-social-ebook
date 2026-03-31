import { describe, it, expect } from "vitest";
import {
    calculateHarmonicConstant,
    generateReciprocalSequence,
    sequenceToBlockIndices
} from "./sequence";

describe("Reciprocal Sequence (The Skeleton)", () => {
    it("should calculate correct harmonic sums", () => {
        expect(calculateHarmonicConstant(1)).toBe(1);
        expect(calculateHarmonicConstant(2)).toBe(1.5); // 1 + 1/2
    });

    it("should generate a logarithmic spread for long histories", () => {
        const target = 1000;
        const divisions = 5;
        const seq = generateReciprocalSequence(target, divisions);

        expect(seq[ 0 ]).toBe(1); // Start of time
        expect(seq[ seq.length - 1 ]).toBe(target); // Present day

        // Verify gaps are larger at the start than the end
        const gapStart = seq[ 1 ] - seq[ 0 ];
        const gapEnd = seq[ 5 ] - seq[ 4 ];
        expect(gapStart).toBeGreaterThan(gapEnd);
    });

    it("should return rounded, unique indices", () => {
        const raw = [ 1, 1.2, 5.8, 10 ];
        const indices = sequenceToBlockIndices(raw);
        expect(indices).toEqual([ 1, 6, 10 ]); // 1.2 rounds to 1 (deduped), 5.8 rounds to 6
    });
});