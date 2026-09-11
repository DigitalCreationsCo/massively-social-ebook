/** Canonical prefix for PX resource addresses. */
export const PX_URI_PREFIX = "px://";

// Read compatibility for persisted channel/entity records is intentionally
// isolated here. New configuration and every value returned by this module
// use the canonical PX spelling.
const LEGACY_NAP_URI_PREFIX = "nap://";

export function isReadablePxUri(value: string): boolean {
  return value.startsWith(PX_URI_PREFIX) || value.startsWith(LEGACY_NAP_URI_PREFIX);
}

export function canonicalizePxUri(value: string): string {
  return value.startsWith(LEGACY_NAP_URI_PREFIX)
    ? `${PX_URI_PREFIX}${value.slice(LEGACY_NAP_URI_PREFIX.length)}`
    : value;
}
