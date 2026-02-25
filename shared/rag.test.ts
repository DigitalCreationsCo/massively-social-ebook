import { describe, it, expect } from 'vitest';
import {
  calculateHarmonicConstant,
  generateReciprocalSequence,
  sequenceToBlockIndices,
  RAG_DIVISIONS,
  RAG_MIN_BLOCKS,
} from './rag';

describe('RAG Utilities', () => {
  describe('calculateHarmonicConstant', () => {
    it('returns 0 for n <= 0', () => {
      expect(calculateHarmonicConstant(0)).toBe(0);
      expect(calculateHarmonicConstant(-1)).toBe(0);
    });

    it('returns 1 for n = 1', () => {
      expect(calculateHarmonicConstant(1)).toBe(1);
    });

    it('returns 1 + 1/2 for n = 2', () => {
      expect(calculateHarmonicConstant(2)).toBe(1.5);
    });

    it('returns correct harmonic sum for n = 5', () => {
      // H(5) = 1 + 1/2 + 1/3 + 1/4 + 1/5 = 2.2833...
      const result = calculateHarmonicConstant(5);
      expect(result).toBeCloseTo(2.2833, 3);
    });
  });

  describe('generateReciprocalSequence', () => {
    it('returns [1] when targetN <= 1', () => {
      expect(generateReciprocalSequence(1, 5)).toEqual([1]);
      expect(generateReciprocalSequence(0, 5)).toEqual([1]);
    });

    it('returns [1] when divisions <= 0', () => {
      expect(generateReciprocalSequence(10, 0)).toEqual([1]);
      expect(generateReciprocalSequence(10, -1)).toEqual([1]);
    });

    it('produces a sequence from 1 to targetN with correct length', () => {
      const seq = generateReciprocalSequence(100, 5);
      expect(seq).toHaveLength(6); // divisions + 1
      expect(seq[0]).toBe(1);
      expect(seq[seq.length - 1]).toBeCloseTo(100, 0);
    });

    it('produces monotonically increasing values', () => {
      const seq = generateReciprocalSequence(50, 5);
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i]).toBeGreaterThan(seq[i - 1]);
      }
    });

    it('has decreasing jump sizes (reciprocal spacing)', () => {
      const seq = generateReciprocalSequence(100, 5);
      const jumps: number[] = [];
      for (let i = 1; i < seq.length; i++) {
        jumps.push(seq[i] - seq[i - 1]);
      }
      // Each jump should be smaller than the previous
      for (let i = 1; i < jumps.length; i++) {
        expect(jumps[i]).toBeLessThan(jumps[i - 1]);
      }
    });

    it('works with small targetN and 1 division', () => {
      const seq = generateReciprocalSequence(5, 1);
      expect(seq).toEqual([1, 5]);
    });

    it('works with targetN = 2 and 1 division', () => {
      const seq = generateReciprocalSequence(2, 1);
      expect(seq).toEqual([1, 2]);
    });
  });

  describe('sequenceToBlockIndices', () => {
    it('rounds sequence values to integers', () => {
      const result = sequenceToBlockIndices([1, 5.3, 12.7, 25.1, 50]);
      expect(result).toEqual([1, 5, 13, 25, 50]);
    });

    it('deduplicates indices', () => {
      const result = sequenceToBlockIndices([1, 1.4, 1.6, 5, 10]);
      // 1.4 rounds to 1, 1.6 rounds to 2
      expect(result).toEqual([1, 2, 5, 10]);
    });

    it('sorts ascending', () => {
      const result = sequenceToBlockIndices([10, 1, 5]);
      expect(result).toEqual([1, 5, 10]);
    });

    it('clamps minimum to 1', () => {
      const result = sequenceToBlockIndices([0.2, 0.5, 3]);
      expect(result).toEqual([1, 3]);
    });

    it('handles single element', () => {
      expect(sequenceToBlockIndices([1])).toEqual([1]);
    });

    it('handles empty array', () => {
      expect(sequenceToBlockIndices([])).toEqual([]);
    });
  });

  describe('constants', () => {
    it('RAG_DIVISIONS is 5', () => {
      expect(RAG_DIVISIONS).toBe(5);
    });

    it('RAG_MIN_BLOCKS is 3', () => {
      expect(RAG_MIN_BLOCKS).toBe(3);
    });
  });
});
