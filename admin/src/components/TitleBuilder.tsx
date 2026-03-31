import { useState, useEffect, useCallback } from 'react';
import { TitleConfig, TitleFormat, NumberSource, deriveTitleFromConfig, computeTitleContext } from '@shared/title';

// ─── Constants ────────────────────────────────────────────────────────────────

const FORMAT_OPTIONS: {
    value: TitleFormat;
    label: string;
    example: string;
}[] = [
        { value: 'numbered', label: 'Numbered', example: 'Alibi: Case 4' },
        { value: 'numbered_subtitle', label: 'Numbered + subtitle', example: 'Alibi — Case 4: The Confession' },
        { value: 'in_world', label: 'In-world', example: 'Hunters: 12 Days Before The Heist' },
        { value: 'season_episode', label: 'Season · Episode', example: 'Alibi · S2 E4' },
    ];

const NUMBER_SOURCE_OPTIONS: { value: NumberSource; label: string; description: string; }[] = [
    { value: 'episode', label: 'Episode', description: 'Resets to 1 at the start of each season' },
    { value: 'absolute', label: 'Absolute', description: 'Lifetime total — never resets' },
    { value: 'day_of_month', label: 'Day of month', description: 'Calendar day of the session (1–31)' },
];

export const DEFAULT_TITLE_CONFIG: TitleConfig = {
    format: 'numbered',
    programName: '',
    sessionLabel: 'Day',
    subtitle: '',
    numberSource: 'episode',
    seasonSize: 30,
    showSeason: false,
    seasonLabel: 'S',
    inWorldTemplate: '{n} Days Before The Heist',
    inWorldMode: 'countup',
    inWorldTotal: 30,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldRow({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="grid grid-cols-[160px_1fr] gap-3 items-start py-2">
            <div className="pt-1.5">
                <div className="text-sm text-gray-700">{ label }</div>
                { hint && <div className="text-xs text-gray-400 mt-0.5 leading-snug">{ hint }</div> }
            </div>
            <div>{ children }</div>
        </div>
    );
}

function Divider() {
    return <div className="border-t border-gray-100 my-1" />;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface TitleBuilderProps {
    /** Pre-populate from an existing schedule. Null = start with defaults. */
    initialConfig?: TitleConfig | null;
    /** Fires on every keystroke / change — use to keep parent in sync. */
    onChange?: (config: TitleConfig) => void;
    /** Fires when user clicks Save. */
    onSave?: (config: TitleConfig) => void;
    /** Fires when user clicks Cancel. */
    onCancel?: () => void;
    /** Disable the save button while a network request is in flight. */
    saving?: boolean;
}

export default function TitleBuilder({
    initialConfig,
    onChange,
    onSave,
    onCancel,
    saving = false,
}: TitleBuilderProps) {
    const [ config, setConfig ] = useState<TitleConfig>(() => ({
        ...DEFAULT_TITLE_CONFIG,
        ...initialConfig,
    }));
    const [ previewN, setPreviewN ] = useState(4);

    // Sync upward whenever config changes
    useEffect(() => {
        onChange?.(config);
    }, [ config ]); // eslint-disable-line react-hooks/exhaustive-deps

    const update = useCallback(<K extends keyof TitleConfig>(key: K, value: TitleConfig[ K ]) => {
        setConfig((prev) => ({ ...prev, [ key ]: value }));
    }, []);

    // Derived preview
    const ctx = computeTitleContext(previewN, config);
    const previewTitle = deriveTitleFromConfig(config, ctx);

    // Which fields are visible for the current format
    const fmt = config.format;
    const showSessionLabel = fmt === 'numbered' || fmt === 'numbered_subtitle';
    const showSubtitle = fmt === 'numbered_subtitle';
    const showInWorld = fmt === 'in_world';
    const showSeasonDisplay = fmt !== 'season_episode'; // SE always shows season

    return (
        <div className="space-y-5">

            {/* ── Format picker ─────────────────────────────────────────────────── */ }
            <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Format</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    { FORMAT_OPTIONS.map((opt) => (
                        <button
                            key={ opt.value }
                            onClick={ () => update('format', opt.value) }
                            className={ `text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${config.format === opt.value
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 hover:border-gray-300 text-gray-700'
                                }` }
                        >
                            <div className="font-medium">{ opt.label }</div>
                            <div className={ `text-xs mt-0.5 italic leading-snug ${config.format === opt.value ? 'text-blue-500' : 'text-gray-400'
                                }` }>
                                { opt.example }
                            </div>
                        </button>
                    )) }
                </div>
            </div>

            {/* ── Config fields ──────────────────────────────────────────────────── */ }
            <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Config</div>
                <div className="border border-gray-200 rounded-lg px-4 divide-y divide-gray-100">

                    <FieldRow label="Program name">
                        <input
                            type="text"
                            value={ config.programName }
                            onChange={ (e) => update('programName', e.target.value) }
                            placeholder="e.g. Midnight Alibi"
                            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </FieldRow>

                    { showSessionLabel && (
                        <FieldRow label="Session label" hint="The word before the number">
                            <input
                                type="text"
                                value={ config.sessionLabel ?? '' }
                                onChange={ (e) => update('sessionLabel', e.target.value) }
                                placeholder="e.g. Case, Day, Entry, Chapter"
                                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </FieldRow>
                    ) }

                    { showSubtitle && (
                        <FieldRow label="Subtitle" hint="Default subtitle — can be overridden per session">
                            <input
                                type="text"
                                value={ config.subtitle ?? '' }
                                onChange={ (e) => update('subtitle', e.target.value) }
                                placeholder="e.g. The Confession"
                                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </FieldRow>
                    ) }

                    { showInWorld && (
                        <>
                            <FieldRow label="Template" hint="Use {n} as the number placeholder">
                                <input
                                    type="text"
                                    value={ config.inWorldTemplate ?? '' }
                                    onChange={ (e) => update('inWorldTemplate', e.target.value) }
                                    placeholder="e.g. {n} Days Before The Heist"
                                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </FieldRow>

                            <FieldRow label="Counter direction">
                                <select
                                    value={ config.inWorldMode ?? 'countup' }
                                    onChange={ (e) => update('inWorldMode', e.target.value as 'countup' | 'countdown') }
                                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                    <option value="countup">Count up (1, 2, 3…)</option>
                                    <option value="countdown">Countdown (30, 29, 28…)</option>
                                </select>
                            </FieldRow>

                            { config.inWorldMode === 'countdown' && (
                                <FieldRow label="Countdown total" hint="Usually equals season size">
                                    <input
                                        type="number"
                                        min={ 1 }
                                        value={ config.inWorldTotal ?? 30 }
                                        onChange={ (e) => update('inWorldTotal', parseInt(e.target.value) || 30) }
                                        className="w-32 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </FieldRow>
                            ) }
                        </>
                    ) }

                    <Divider />

                    <FieldRow label="Number source">
                        <div className="space-y-1.5 pt-0.5">
                            { NUMBER_SOURCE_OPTIONS.map((opt) => (
                                <label key={ opt.value } className="flex items-start gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="numberSource"
                                        value={ opt.value }
                                        checked={ (config.numberSource ?? 'episode') === opt.value }
                                        onChange={ () => update('numberSource', opt.value) }
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <span className="text-sm text-gray-700">{ opt.label }</span>
                                        <span className="text-xs text-gray-400 ml-1.5">{ opt.description }</span>
                                    </div>
                                </label>
                            )) }
                        </div>
                    </FieldRow>

                    <FieldRow label="Season size" hint="Sessions per season (implicit — always tracked)">
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                min={ 1 }
                                value={ config.seasonSize ?? 30 }
                                onChange={ (e) => update('seasonSize', parseInt(e.target.value) || 30) }
                                className="w-20 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <span className="text-xs text-gray-400">sessions</span>
                        </div>
                    </FieldRow>

                    { showSeasonDisplay && (
                        <FieldRow label="Season prefix" hint="Prepend e.g. ' S2 ·' to the title">
                            <div className="flex items-center gap-3 pt-1">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={ config.showSeason ?? false }
                                        onChange={ (e) => update('showSeason', e.target.checked) }
                                    />
                                    <span className="text-sm text-gray-700">Show season in title</span>
                                </label>
                                { config.showSeason && (
                                    <input
                                        type="text"
                                        value={ config.seasonLabel ?? 'S' }
                                        onChange={ (e) => update('seasonLabel', e.target.value) }
                                        placeholder="S"
                                        className="w-16 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                ) }
                            </div>
                        </FieldRow>
                    ) }

                </div>
            </div>

            {/* ── Live preview ───────────────────────────────────────────────────── */ }
            <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Preview</div>
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
                    <div className="text-base font-medium text-gray-900 leading-snug min-h-[1.5rem]">
                        { previewTitle || <span className="text-gray-400 italic">Enter a program name to preview</span> }
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex gap-1.5 flex-wrap">
                            <span className="text-xs px-2 py-0.5 bg-white border border-gray-200 rounded text-gray-500">
                                Season { ctx.seasonNumber }
                            </span>
                            <span className="text-xs px-2 py-0.5 bg-white border border-gray-200 rounded text-gray-500">
                                Episode { ctx.episodeNumber }
                            </span>
                            <span className="text-xs px-2 py-0.5 bg-white border border-gray-200 rounded text-gray-500">
                                #{ ctx.sessionNumber } overall
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5 ml-auto">
                            <label className="text-xs text-gray-400">Session #</label>
                            <input
                                type="number"
                                min={ 1 }
                                value={ previewN }
                                onChange={ (e) => setPreviewN(Math.max(1, parseInt(e.target.value) || 1)) }
                                className="w-16 border border-gray-300 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                    {/* Show a few adjacent sessions so season rollovers are visible */ }
                    { previewN > 1 && (
                        <div className="pt-2 border-t border-gray-200 space-y-1">
                            <div className="text-xs text-gray-400 mb-1">Adjacent sessions</div>
                            { [ -1, 0, 1 ].map((offset) => {
                                const n = Math.max(1, previewN + offset);
                                const c = computeTitleContext(n, config);
                                const t = deriveTitleFromConfig(config, c);
                                return (
                                    <div key={ n } className={ `text-xs flex items-center gap-2 ${offset === 0 ? 'text-gray-900 font-medium' : 'text-gray-400'}` }>
                                        <span className="tabular-nums w-5 text-right">{ n }</span>
                                        <span>→</span>
                                        <span>{ t }</span>
                                        { c.episodeNumber === 1 && n !== 1 && (
                                            <span className="ml-1 px-1 py-0 bg-amber-100 text-amber-700 rounded text-[10px]">season start</span>
                                        ) }
                                    </div>
                                );
                            }) }
                        </div>
                    ) }
                </div>
            </div>;

            {/* ── Actions ────────────────────────────────────────────────────────── */ }
            {
                (onSave || onCancel) && (
                    <div className="flex items-center justify-end gap-2 pt-1">
                        { onCancel && (
                            <button
                                onClick={ onCancel }
                                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                        ) }
                        { onSave && (
                            <button
                                onClick={ () => onSave(config) }
                                disabled={ saving || !config.programName.trim() }
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                { saving ? 'Saving…' : 'Save title config' }
                            </button>
                        ) }
                    </div>
                )
            }
        </div >
    );
}