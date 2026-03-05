import { describe, it, expect } from 'vitest';
import { getChannelId } from './channels';

describe('Channel Validation', () => {
  it('validates correct channel IDs', () => {
    expect(getChannelId('scifi')).toBe('scifi');
    expect(getChannelId('mystery')).toBe('mystery');
  });

  it('defaults invalid IDs to mystery', () => {
    expect(getChannelId('unknown')).toBe('mystery');
    expect(getChannelId(null)).toBe('mystery');
    expect(getChannelId(undefined)).toBe('mystery');
    expect(getChannelId('')).toBe('mystery');
  });
});
