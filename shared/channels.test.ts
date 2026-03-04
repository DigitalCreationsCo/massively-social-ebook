import { describe, it, expect } from 'vitest';
import { getChannelId } from './channels';

describe('Channel Validation', () => {
  it('validates correct channel IDs', () => {
    expect(getChannelId('scifi')).toBe('scifi');
    expect(getChannelId('mystery')).toBe('mystery');
  });

  it('defaults invalid IDs to scifi', () => {
    expect(getChannelId('unknown')).toBe('scifi');
    expect(getChannelId(null)).toBe('scifi');
    expect(getChannelId(undefined)).toBe('scifi');
    expect(getChannelId('')).toBe('scifi');
  });
});
