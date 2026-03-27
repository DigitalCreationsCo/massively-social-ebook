/**
 * title.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Option-based session title composition for The 25th Chapter.
 *
 * Supports four title formats, implicit seasonal structuring, and per-session
 * subtitle overrides. TitleConfig lives on the Schedule (stored as JSONB) so
 * each program can have its own identity without schema migrations.
 *
 * ─── Format examples ─────────────────────────────────────────────────────────
 *
 *  numbered           "Midnight Alibi: Case 26"
 *  numbered_subtitle  "Midnight Alibi — Case 26: The Confession"
 *  in_world           "Hunters: 12 Days Before The Heist"
 *                     "Hunters: Day 3 of the Siege"
 *  season_episode     "Midnight Alibi · S2 E4"
 *
 * ─── Seasonal structuring ────────────────────────────────────────────────────
 *
 *  Sessions are counted per-schedule (tracked in schedules.sessionCount).
 *  Season and episode numbers are derived deterministically from that count
 *  and stored on each session row for easy querying and filtering.
 *
 *  Default season size: 30 sessions.
 *  Seasons are implicit — they don't have to appear in the title, but the
 *  data is always there.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * How the visible number inside the title is sourced.
 *
 *  'episode'      — position within the current season (resets each season)
 *  'absolute'     — total sessions ever run on this schedule (never resets)
 *  'day_of_month' — calendar day of scheduledStart (legacy / quick-and-dirty)
 */
export type NumberSource = 'episode' | 'absolute' | 'day_of_month';

/**
 * The four title format strategies.
 */
export type TitleFormat =
    | 'numbered'           // "Midnight Alibi: Case 26"
    | 'numbered_subtitle'  // "Midnight Alibi — Case 26: The Confession"
    | 'in_world'           // "Hunters: 12 Days Before The Heist"
    | 'season_episode';    // "Midnight Alibi · S2 E4"

/**
 * Stored as JSONB on schedules.titleConfig.
 * All fields except `format` and `programName` are optional.
 */
export interface TitleConfig {
    /** Which format strategy to use. */
    format: TitleFormat;

    /** The canonical program name shown at the start of every title. */
    programName: string;

    // ── Numbering ────────────────────────────────────────────────────────────

    /**
     * Where the visible number comes from.
     * Defaults to 'episode' (position within current season).
     */
    numberSource?: NumberSource;

    // ── numbered / numbered_subtitle ─────────────────────────────────────────

    /**
     * The word placed before the number in 'numbered' and 'numbered_subtitle'.
     * e.g. "Case", "Entry", "Day", "Chapter", "Report"
     * Defaults to "Day".
     */
    sessionLabel?: string;

    /**
     * Static fallback subtitle for 'numbered_subtitle'.
     * Can be overridden per-session via sessions.subtitle.
     */
    subtitle?: string;

    // ── in_world ─────────────────────────────────────────────────────────────

    /**
     * Template string for 'in_world' format.
     * Use `{n}` as the placeholder for the resolved number.
     *
     * Count-up examples:
     *   "{n} Days Into The Journey"
     *   "Day {n} of the Trial"
     *   "Hour {n}"
     *
     * Countdown examples (set inWorldMode: 'countdown', inWorldTotal: N):
     *   "{n} Days Before The Heist"
     *   "{n} Hours Remain"
     */
    inWorldTemplate?: string;

    /**
     * Direction of the in-world counter.
     * 'countup'   — {n} increases each session (default)
     * 'countdown' — {n} = inWorldTotal - resolvedN + 1
     */
    inWorldMode?: 'countup' | 'countdown';

    /**
     * Required when inWorldMode is 'countdown'.
     * Typically equals the season size.
     */
    inWorldTotal?: number;

    // ── Seasonal display ─────────────────────────────────────────────────────

    /**
     * Number of sessions per season. Defaults to 30.
     * Controls season/episode derivation but does NOT have to appear in titles.
     */
    seasonSize?: number;

    /**
     * Whether to prepend the season identifier to the title.
     * When false (default) seasons are implicit — tracked in the DB but hidden.
     *
     * 'numbered'          → "S2 · Midnight Alibi: Case 4"
     * 'numbered_subtitle' → "S2 · Midnight Alibi — Case 4: The Confession"
     * 'season_episode'    → always shows season; this flag has no extra effect
     */
    showSeason?: boolean;

    /**
     * Label prefix for the season when showSeason is true.
     * e.g. "S", "Season", "Arc", "Vol"
     * Defaults to "S".
     */
    seasonLabel?: string;
}

/**
 * Runtime context passed to deriveTitleFromConfig.
 * Built by computeTitleContext once the schedule's sessionCount is known.
 */
export interface TitleContext {
    /** 1-based total sessions ever spawned by this schedule. */
    sessionNumber: number;
    /** 1-based season index (derived from sessionNumber and seasonSize). */
    seasonNumber: number;
    /** 1-based position within the current season. */
    episodeNumber: number;
    /** The UTC start timestamp of this session. */
    scheduledStart: Date;
    /** Optional per-session subtitle override (from sessions.subtitle). */
    subtitle?: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute the TitleContext for a session about to be spawned.
 *
 * Call this before createSession, using the schedule's current sessionCount
 * (before incrementing it).
 *
 * @param nextSessionNumber  schedules.sessionCount + 1  (1-based)
 * @param config             the schedule's TitleConfig
 * @param scheduledStart     the computed session start time
 * @param subtitle           optional per-session subtitle override
 */
export function computeTitleContext(
    nextSessionNumber: number,
    config: TitleConfig,
    scheduledStart: Date = new Date(),
): TitleContext {
    const seasonSize = config.seasonSize ?? 30;
    const seasonNumber = Math.floor((nextSessionNumber - 1) / seasonSize) + 1;
    const episodeNumber = ((nextSessionNumber - 1) % seasonSize) + 1;

    return {
        sessionNumber: nextSessionNumber,
        seasonNumber,
        episodeNumber,
        scheduledStart,
        subtitle: config.subtitle,
    };
}

/**
 * Build the full session title string from a config and context.
 *
 * This is the single source of truth for title rendering — used by the
 * scheduler at spawn time and can be called anywhere titles need re-rendering.
 */
export function deriveTitleFromConfig(config: TitleConfig, ctx: TitleContext): string {
    switch (config.format) {
        case 'numbered':
            return buildNumbered(config, ctx);

        case 'numbered_subtitle':
            return buildNumberedSubtitle(config, ctx);

        case 'in_world':
            return buildInWorld(config, ctx);

        case 'season_episode':
            return buildSeasonEpisode(config, ctx);

        default:
            return buildFallback(ctx);
    }
}

// ─── Format builders ─────────────────────────────────────────────────────────

/** "Midnight Alibi: Case 26"  or  "S2 · Midnight Alibi: Case 4" */
function buildNumbered(config: TitleConfig, ctx: TitleContext): string {
    const label = config.sessionLabel ?? 'Day';
    const n = resolveNumber(config, ctx);
    const core = `${config.programName}: ${label} ${n}`;
    return withSeasonPrefix(core, config, ctx);
}

/** "Midnight Alibi — Case 26: The Confession"  or  "S2 · Midnight Alibi — Case 4: The Confession" */
function buildNumberedSubtitle(config: TitleConfig, ctx: TitleContext): string {
    const label = config.sessionLabel ?? 'Day';
    const n = resolveNumber(config, ctx);
    const subtitle = ctx.subtitle ?? config.subtitle;

    const core = subtitle
        ? `${config.programName} — ${label} ${n}: ${subtitle}`
        : `${config.programName} — ${label} ${n}`;

    return withSeasonPrefix(core, config, ctx);
}

/**
 * "Hunters: 12 Days Before The Heist"
 * "Hunters: Day 3 of the Siege"
 *
 * Requires config.inWorldTemplate with a `{n}` placeholder.
 * Falls back to plain numbered if template is missing.
 */
function buildInWorld(config: TitleConfig, ctx: TitleContext): string {
    if (!config.inWorldTemplate) {
        // Graceful degradation — still a usable title
        return buildNumbered(config, ctx);
    }

    const n = resolveInWorldN(config, ctx);
    const rendered = config.inWorldTemplate.replace('{n}', String(n));
    return `${config.programName}: ${rendered}`;
}

/** "Midnight Alibi · S2 E4" — season always shown in this format */
function buildSeasonEpisode(config: TitleConfig, ctx: TitleContext): string {
    const label = config.seasonLabel ?? 'S';
    return `${config.programName} · ${label}${ctx.seasonNumber} E${ctx.episodeNumber}`;
}

function buildFallback(ctx: TitleContext): string {
    return `Session ${ctx.sessionNumber}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve the numeric token based on numberSource. */
function resolveNumber(config: TitleConfig, ctx: TitleContext): number {
    switch (config.numberSource ?? 'episode') {
        case 'absolute':
            return ctx.sessionNumber;
        case 'day_of_month':
            return ctx.scheduledStart.getDate();
        case 'episode':
        default:
            return ctx.episodeNumber;
    }
}

/** Resolve the in-world counter (handles countdown inversion). */
function resolveInWorldN(config: TitleConfig, ctx: TitleContext): number {
    const n = resolveNumber(config, ctx);
    if (config.inWorldMode === 'countdown') {
        const total = config.inWorldTotal ?? (config.seasonSize ?? 30);
        return Math.max(1, total - n + 1);
    }
    return n;
}

/** Optionally prepend a season prefix when showSeason is true. */
function withSeasonPrefix(core: string, config: TitleConfig, ctx: TitleContext): string {
    if (!config.showSeason) return core;
    const label = config.seasonLabel ?? 'S';
    return `${label}${ctx.seasonNumber} · ${core}`;
}

// ─── Preset configs (optional convenience exports) ───────────────────────────
//
// These can be used as defaults when creating schedules, or as references
// when building a schedule creation UI.

export const TITLE_PRESETS: Record<string, TitleConfig> = {
    /**
     * Classic numbered sessions.
     * "Midnight Alibi: Case 4"
     */
    numbered: {
        format: 'numbered',
        programName: 'My Program',
        sessionLabel: 'Day',
        numberSource: 'episode',
        seasonSize: 30,
    },

    /**
     * Numbered with a subtitle slot.
     * "Midnight Alibi — Case 4: The Confession"
     */
    numberedSubtitle: {
        format: 'numbered_subtitle',
        programName: 'My Program',
        sessionLabel: 'Case',
        numberSource: 'episode',
        seasonSize: 30,
    },

    /**
     * Count-up in-world template.
     * "Hunters: Day 3 of the Siege"
     */
    inWorldCountUp: {
        format: 'in_world',
        programName: 'My Program',
        inWorldTemplate: 'Day {n} of the Siege',
        inWorldMode: 'countup',
        numberSource: 'episode',
        seasonSize: 30,
    },

    /**
     * Countdown in-world template.
     * "Hunters: 12 Days Before The Heist"
     */
    inWorldCountdown: {
        format: 'in_world',
        programName: 'My Program',
        inWorldTemplate: '{n} Days Before The Heist',
        inWorldMode: 'countdown',
        inWorldTotal: 30,
        numberSource: 'episode',
        seasonSize: 30,
    },

    /**
     * Explicit season + episode badge.
     * "Midnight Alibi · S2 E4"
     */
    seasonEpisode: {
        format: 'season_episode',
        programName: 'My Program',
        seasonLabel: 'S',
        seasonSize: 30,
    },
};