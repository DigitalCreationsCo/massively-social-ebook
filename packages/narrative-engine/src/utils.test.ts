import { describe, it, expect, vi } from 'vitest';
import { normalizeScore, validateProviderShape } from './utils';
import type { NarrativeProvider } from './provider';
import type { BaseNarrativeBlock, BaseNarrativeLore } from './types';

describe('normalizeScore', () => {
  it('should return normalized value in 0-1 range', () => {
    expect(normalizeScore(5, 0, 10)).toBe(0.5);
    expect(normalizeScore(0, 0, 10)).toBe(0);
    expect(normalizeScore(10, 0, 10)).toBe(1);
    expect(normalizeScore(75, 50, 100)).toBe(0.5);
  });

  it('should handle edge case when min === max', () => {
    expect(normalizeScore(5, 5, 5)).toBe(0);
  });

  it('should clamp values outside range', () => {
    expect(normalizeScore(-5, 0, 10)).toBe(0);
    expect(normalizeScore(15, 0, 10)).toBe(1);
  });
});

describe('validateProviderShape', () => {
  it('should return true for valid provider', () => {
    const validProvider: NarrativeProvider<BaseNarrativeBlock, BaseNarrativeLore> = {
      getLoreAtoms: async () => [],
      getNotableEvents: async () => [],
      getBlocksByIndices: async () => [],
      getHybridSearchCandidates: async () => [],
      getBlockCount: async () => 0,
      addBlock: async () => { },
      getProviderType: () => 'test'
    };
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(validateProviderShape(validProvider)).toBe(true);
    expect(consoleSpy).not.toHaveBeenCalled();
    
    consoleSpy.mockRestore();
  });

  it('should return false for missing methods', () => {
    const invalidProvider = {
      getLoreAtoms: async () => [],
    };
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(validateProviderShape(invalidProvider)).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NarrativeEngine] Invalid Provider: Missing methods')
    );
    
    consoleSpy.mockRestore();
  });
});
