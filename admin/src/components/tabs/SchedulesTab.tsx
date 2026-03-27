import { useState, useCallback } from 'react';
import { useAdminToken } from '../../hooks/useAdminToken';
import { usePolling } from '../../hooks/usePolling';
import { adminFetch } from '../../api/client';
import TitleBuilder from '../TitleBuilder';
import { deriveTitleFromConfig, type TitleConfig } from '@shared/title';
import { Schedule, Channel } from '@shared/schema';

// ─── Preview helper ───────────────────────────────────────────────────────────

function getConfigPreview(config: TitleConfig | null | undefined): string {
    if (!config) return '—';
    try {
        const seasonSize = config.seasonSize ?? 30;
        const ctx = {
            sessionNumber: 4,
            seasonNumber: 1,
            episodeNumber: 4,
            scheduledStart: new Date(),
            subtitle: config.subtitle,
            seasonSize
        };
        return deriveTitleFromConfig(config, ctx);
    } catch {
        return '—';
    }
}

// ─── Schedule row ─────────────────────────────────────────────────────────────

interface ScheduleRowProps {
    schedule: Schedule;
    isEditing: boolean;
    isSaving: boolean;
    onEditStart: () => void;
    onSave: (config: TitleConfig) => void;
    onCancel: () => void;
}

function ScheduleRow({
    schedule,
    isEditing,
    isSaving,
    onEditStart,
    onSave,
    onCancel,
}: ScheduleRowProps) {
    const days = Array.isArray(schedule.scheduledDays)
        ? schedule.scheduledDays.join(', ')
        : '—';

    const config = schedule.titleConfig as TitleConfig | null;

    return (
        <>
            <tr className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-3 text-sm text-gray-500">#{ schedule.id }</td>
                <td className="py-2 px-3 text-sm font-medium">{ schedule.channelId }</td>
                <td className="py-2 px-3 text-sm text-gray-600 capitalize">{ days }</td>
                <td className="py-2 px-3 text-sm text-gray-600">{ schedule.scheduledTime ?? '—' }</td>
                <td className="py-2 px-3">
                    <span className={ `px-2 py-0.5 rounded text-xs font-medium ${schedule.intervalEnabled
                        ? 'text-green-700 bg-green-50'
                        : 'text-gray-500 bg-gray-100'
                        }` }>
                        { schedule.intervalEnabled ? 'Active' : 'Paused' }
                    </span>
                </td>
                <td className="py-2 px-3">
                    { config ? (
                        <div>
                            <div className="text-xs font-medium text-gray-700 truncate max-w-[220px]">
                                { getConfigPreview(config) }
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5 capitalize">
                                { config.format.replace('_', ' ') } · { config.seasonSize ?? 30 } per season
                            </div>
                        </div>
                    ) : (
                        <span className="text-xs text-gray-400 italic">No title config</span>
                    ) }
                </td>
                <td className="py-2 px-3 text-sm">
                    { schedule.sessionCount != null && (
                        <span className="text-gray-600">{ schedule.sessionCount }</span>
                    ) }
                </td>
                <td className="py-2 px-3">
                    <button
                        onClick={ onEditStart }
                        className="text-xs text-blue-600 hover:underline"
                    >
                        { isEditing ? 'Editing…' : 'Edit title' }
                    </button>
                </td>
            </tr>

            {/* Inline editor row */ }
            { isEditing && (
                <tr>
                    <td colSpan={ 8 } className="px-4 py-5 bg-gray-50 border-b border-gray-200">
                        <div className="max-w-2xl">
                            <div className="text-sm font-medium text-gray-700 mb-4">
                                Title config — Schedule #{ schedule.id } ({ schedule.channelId })
                            </div>
                            <TitleBuilder
                                initialConfig={ config }
                                onSave={ onSave }
                                onCancel={ onCancel }
                                saving={ isSaving }
                            />
                        </div>
                    </td>
                </tr>
            ) }
        </>
    );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function SchedulesTab() {
    const { token } = useAdminToken();
    const [ channelFilter, setChannelFilter ] = useState('');
    const [ editingId, setEditingId ] = useState<number | null>(null);
    const [ savingId, setSavingId ] = useState<number | null>(null);
    const [ saveError, setSaveError ] = useState<string | null>(null);

    const fetchChannels = useCallback(async () => {
        return adminFetch<Channel[]>('/channels', token)
    }, [token])

    const { data: channels } = usePolling(fetchChannels, 30000, [token])

    const fetchSchedules = useCallback(async () => {
        const query = new URLSearchParams();
        if (channelFilter) query.set('channelId', channelFilter);
        return adminFetch<Schedule[]>(`/schedules?${query}`, token);
    }, [ token, channelFilter ]);

    const { data: schedules, loading, error, refresh, lastUpdated } = usePolling(
        fetchSchedules,
        10000,
        [ token, channelFilter ],
    );

    const handleSave = async (scheduleId: number, config: TitleConfig) => {
        setSavingId(scheduleId);
        setSaveError(null);
        try {
            await adminFetch(`/schedules/${scheduleId}`, token, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ titleConfig: config }),
            });
            setEditingId(null);
            refresh();
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSavingId(null);
        }
    };

    return (
        <div className="p-4">
            {/* ── Toolbar ──────────────────────────────────────────────────────── */ }
            <div className="flex gap-4 mb-4 items-center flex-wrap">
                <label className="text-sm">
                    Channel:
                    <select
                        value={ channelFilter }
                        onChange={ (e) => {
                            setChannelFilter(e.target.value);
                            setEditingId(null);
                        } }
                        className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                        <option value="">All</option>
                        {channels?.map(ch => (
                            <option key={ch.id} value={ch.channelId}>{ch.name}</option>
                        ))}
                    </select>
                </label>
                <button
                    onClick={ refresh }
                    className="text-sm text-blue-600 hover:underline"
                >
                    Refresh
                </button>
                { lastUpdated && (
                    <span className="text-xs text-gray-400">
                        Updated: { lastUpdated.toLocaleTimeString() }
                    </span>
                ) }
                { saveError && (
                    <span className="text-xs text-red-500 ml-auto">Error: { saveError }</span>
                ) }
            </div>

            {/* ── States ───────────────────────────────────────────────────────── */ }
            { loading && <p className="text-gray-500 text-sm">Loading…</p> }
            { error && <p className="text-red-500 text-sm">Error: { error.message }</p> }

            {/* ── Table ────────────────────────────────────────────────────────── */ }
            <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="border-b border-gray-200">
                            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">ID</th>
                            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Channel</th>
                            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Days</th>
                            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Time</th>
                            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Title config</th>
                            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Sessions</th>
                            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        { schedules?.map((schedule) => (
                            <ScheduleRow
                                key={ schedule.id }
                                schedule={ schedule }
                                isEditing={ editingId === schedule.id }
                                isSaving={ savingId === schedule.id }
                                onEditStart={ () => setEditingId(
                                    editingId === schedule.id ? null : schedule.id
                                ) }
                                onSave={ (config) => handleSave(schedule.id, config) }
                                onCancel={ () => setEditingId(null) }
                            />
                        )) }
                    </tbody>
                </table>
            </div>

            { schedules?.length === 0 && !loading && (
                <p className="text-gray-500 mt-4 text-sm">No schedules found</p>
            ) }
        </div>
    );
}