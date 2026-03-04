export const CHANNEL_MAP: Record<string, string> = {
  'scifi': 'scifi',
  'mystery': 'mystery'
};

export const REVERSE_CHANNEL_MAP: Record<string, string> = {
  'scifi': 'scifi',
  'mystery': 'mystery'
};

export function getChannelId(id: string | null | undefined): string {
  if (!id) return 'scifi'; // Default
  if (id === 'scifi' || id === 'mystery') return id;
  return 'scifi';
}



export type Channel = 'scifi' | 'mystery';
export const CHANNELS: Channel[] = [ 'scifi', 'mystery' ];
