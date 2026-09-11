/**
 * The single default channel key used in browser routes, API requests, and
 * queue slot identities. It is deliberately a URL-path-safe PX repository
 * identifier, not a `px://` URI.
 */
export const DEFAULT_CHANNEL_ID = "25th-chapter";

/**
 * Channel keys travel through Express and FastAPI path parameters as well as
 * queue slot keys. Restrict them to one URL path segment.
 */
export const CHANNEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeChannelId(channelId: string): boolean {
  return CHANNEL_ID_PATTERN.test(channelId);
}
