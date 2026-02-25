export const CHANNEL_MAP: Record<string, string> = {
  'x7v9z': 'scifi',
  'm2w4k': 'mystery'
};

export const REVERSE_CHANNEL_MAP: Record<string, string> = Object.entries(CHANNEL_MAP).reduce((acc, [ obf, real ]) => {
  acc[ real ] = obf;
  return acc;
}, {} as Record<string, string>);

export function getRealChannelId(obfuscatedId: string | null | undefined): string {
  if (!obfuscatedId) return 'scifi'; // Default
  if (obfuscatedId === 'scifi' || obfuscatedId === 'mystery') return obfuscatedId;
  return CHANNEL_MAP[ obfuscatedId ] || 'scifi';
}

export function getObfuscatedChannelId(realId: string | null | undefined): string {
  if (!realId) return 'ch_sci'; // Default
  return REVERSE_CHANNEL_MAP[ realId ] || 'ch_sci';
}

export type Channel = 'scifi' | 'mystery';
export const CHANNELS: Channel[] = [ 'scifi', 'mystery' ];
