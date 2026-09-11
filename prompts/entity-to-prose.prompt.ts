/**
 * entityToProse.js
 *
 * Converts raw entity objects into clean, prompt-ready prose.
 * Strips all metadata noise (hashes, URIs, variants, version, representations)
 * and formats signal fields into a compact string the model can actually use.
 *
 * Usage:
 *   const prose = structureEntities(entities);
 *   // Inject prose into your user-turn context string
 */

// ─── Noise Filters ────────────────────────────────────────────────────────────

/** Top-level entity keys that are pure infrastructure — never useful to a language model. */
const OMIT_TOP_LEVEL = new Set([
  'id',              // px:// protocol URI — model cannot resolve
  'version',         // document versioning
  'references',      // cross-entity links (empty in practice)
  'representations', // image hashes and file URIs
  'type',            // redundant with entity_type
]);

/** Property-level keys that describe the data model, not the character. */
const OMIT_PROPERTY_KEYS = new Set([
  'variant',         // always "normal" — zero signal
  'variant_of',      // URI reference to parent variant
  'variants',        // array of variant URI strings
]);

/**
 * Returns true if a string value is a URI, file path, or content hash —
 * anything a language model cannot interpret as narrative information.
 */
const isNoiseString = (val) =>
  typeof val === 'string' &&
  (/^(px:|blake3:|https?:|\.\/|\/mnt\/)/.test(val) ||
   /\.(png|jpg|jpeg|webp|pdf|svg)$/i.test(val));

// ─── Value Formatter ──────────────────────────────────────────────────────────

/**
 * Formats a property value into a display string, or returns null if the
 * value is noise, empty, or cannot be meaningfully rendered as prose.
 *
 * @param {*} val
 * @returns {string|null}
 */
function formatValue(val) {
  if (val === null || val === undefined || val === '') return null;

  if (typeof val === 'string') {
    return isNoiseString(val) ? null : val.trim();
  }

  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }

  if (Array.isArray(val)) {
    const clean = val
      .map(formatValue)
      .filter(Boolean);
    return clean.length ? clean.join(', ') : null;
  }

  // Nested objects: flatten one level, skip anything deeper
  if (typeof val === 'object') {
    const entries = Object.entries(val)
      .filter(([k]) => !OMIT_PROPERTY_KEYS.has(k))
      .map(([k, v]) => {
        const formatted = formatValue(v);
        return formatted ? `${humanize(k)}: ${formatted}` : null;
      })
      .filter(Boolean);
    return entries.length ? entries.join('; ') : null;
  }

  return null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Converts snake_case or camelCase keys into readable labels. */
const humanize = (key) =>
  key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();

/** Capitalizes the first letter of a string. */
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Core Formatters ──────────────────────────────────────────────────────────

/**
 * Formats a single entity object into a compact prose block.
 * The name and role form a header; description follows; any remaining
 * signal properties appear as labeled lines beneath.
 *
 * @param {Object} entity
 * @returns {string}
 */
function entityToProse(entity: any) {
  const name = entity.name?.trim() || 'Unknown';
  const props = entity.properties || {};

  // Pull the two known high-signal fields first
  const role        = formatValue(props.role);
  const description = formatValue(props.description);

  // Everything else in properties that isn't known noise
  const extras = Object.entries(props)
    .filter(([key]) =>
      key !== 'role' &&
      key !== 'description' &&
      !OMIT_PROPERTY_KEYS.has(key)
    )
    .map(([key, val]) => {
      const formatted = formatValue(val);
      return formatted ? `${capitalize(humanize(key))}: ${formatted}` : null;
    })
    .filter(Boolean);

  // Compose the block
  const lines = [];

  // Header: "Name — Role" or just "Name"
  lines.push(role ? `${name} — ${role}` : name);

  if (description) lines.push(description);
  lines.push(...extras);

  return lines.join('\n');
}

/**
 * Formats an array of entity objects into a prompt-ready string,
 * grouped by entity_type with a section header per group.
 *
 * Output example:
 *
 *   Characters:
 *   Claire Cole — Major crimes detective
 *   She built her career on seeing what others miss.
 *
 *   Nathan Gunn — Federal investigator
 *   A theft investigation leads him to a mystery.
 *
 * @param {Object[]} entities
 * @returns {string}
 */
export function composeEntitiesPrompt(entities: any[]) {
  if (!Array.isArray(entities) || entities.length === 0) return '';

  // Group by entity_type (fall back to 'entity' if absent)
  const groups = {};
  for (const entity of entities) {
    const type = entity.entity_type || entity.type || 'entity';
    if (!groups[type]) groups[type] = [];
    groups[type].push(entity);
  }

  return Object.entries(groups)
    .map(([type, members]) => {
      const header = `${capitalize(type)}s:`;
      const blocks = members.map(entityToProse).join('\n\n');
      return `${header}\n${blocks}`;
    })
    .join('\n\n');
}