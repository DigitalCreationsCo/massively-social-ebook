import { describe, it, expect } from 'vitest';
import { getRealChannelId, getObfuscatedChannelId, CHANNEL_MAP } from './channels';

describe('Channel Mapping', () => {
  it('maps obfuscated IDs to real IDs', () => {
    expect(getRealChannelId('x7v9z')).toBe('scifi');
    expect(getRealChannelId('m2w4k')).toBe('mystery');
  });

  it('maps real IDs to obfuscated IDs', () => {
    expect(getObfuscatedChannelId('scifi')).toBe('x7v9z');
    expect(getObfuscatedChannelId('mystery')).toBe('m2w4k');
  });

  it('handles unknown obfuscated IDs by returning default', () => {
    expect(getRealChannelId('unknown')).toBe('scifi');
  });

  it('handles null/undefined obfuscated IDs', () => {
    expect(getRealChannelId(null)).toBe('scifi');
    expect(getRealChannelId(undefined)).toBe('scifi');
  });

  it('handles unknown real IDs by returning default obfuscated', () => {
    expect(getObfuscatedChannelId('unknown')).toBe('ch_sci');
  });
});
