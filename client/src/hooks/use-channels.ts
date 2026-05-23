import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/routes';

export interface ChannelInfo {
  id: number;
  channelId: string;
  name: string;
  description: string | null;
  coverImage?: string | null;
  createdAt: string;
}

async function fetchChannels(path: string): Promise<ChannelInfo[]> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to fetch channels: ${res.status}`);
  }
  return res.json();
}

export function useActiveChannels() {
  return useQuery({
    queryKey: [api.channels.active.path],
    queryFn: () => fetchChannels(api.channels.active.path),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useChannels() {
  return useQuery({
    queryKey: [api.channels.list.path],
    queryFn: () => fetchChannels(api.channels.list.path),
    staleTime: 60 * 1000,
  });
}
