import { describe, it, expect } from 'vitest';
import { validateSchemaDates } from '../validateSchema';

describe('The 25th Chapter - Schema Validation Suite', () => {
  // Mock current date to Wednesday, Feb 25, 2026, 08:00:00
  const mockCurrentTime = new Date('2026-02-25T08:00:00Z');

  it('should return true for a valid future session', () => {
    const paramsValidSchema = {
      startDate: '2026-02-25T20:00:00Z', // 8 PM tonight
      endDate: '2026-02-25T20:25:00Z',
      validFrom: '2026-02-25T08:01:00Z'
    };

    const result = validateSchemaDates(paramsValidSchema, mockCurrentTime);
    expect(result).toBe(true);
  });

  it('should return false (fail) if startDate is in the past', () => {
    const paramsStaleSchema = {
      startDate: '2026-02-24T20:00:00Z', // Yesterday
      endDate: '2026-02-24T20:25:00Z',
      validFrom: '2026-02-24T08:00:00Z'
    };

    const result = validateSchemaDates(paramsStaleSchema, mockCurrentTime);
    expect(result).toBe(false);
  });

  it('should return false if session duration is logically invalid (End before Start)', () => {
    const paramsLogicErrorSchema = {
      startDate: '2026-02-25T20:00:00Z',
      endDate: '2026-02-25T19:00:00Z', // Ends an hour before it starts
      validFrom: '2026-02-25T08:00:00Z'
    };

    const result = validateSchemaDates(paramsLogicErrorSchema, mockCurrentTime);
    expect(result).toBe(false);
  });
});
