export type Channel = 'scifi' | 'mystery';
export const CHANNELS: Channel[] = [ 'scifi', 'mystery' ];
export const DEFAULT_CHANNEL: Channel = 'mystery';

export const CHANNEL_MAP: Record<string, string> = {
  'scifi': 'scifi',
  'mystery': 'mystery'
};

export const REVERSE_CHANNEL_MAP: Record<string, string> = {
  'scifi': 'scifi',
  'mystery': 'mystery'
};

export function getChannelId(id: string | null | undefined): string {
  if (!id) return DEFAULT_CHANNEL;
  if (CHANNELS.includes(id as Channel)) return id;
  return DEFAULT_CHANNEL;
}
