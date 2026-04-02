import { useState, useCallback } from 'react'
import { useAdminToken } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch } from '../../api/client';
import { Channel, Schedule } from '@shared/schema';
import TitleBuilder from '../TitleBuilder';
import { deriveTitleFromConfig, type TitleConfig } from '@shared/title';
import { TIMEZONE_OPTIONS, formatDisplayDate } from '@shared/date';

// ─── Preview helper ───────────────────────────────────────────────────────────

function getConfigPreview(config: TitleConfig | null | undefined): string {
  if (!config) return 'No title config';
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
    return 'Invalid config';
  }
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

export default function ChannelsTab() {
  const { token } = useAdminToken()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ name: '', description: '', channelId: '' })
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null)
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null)
  const [showTitleBuilder, setShowTitleBuilder] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({
    scheduledDays: [] as string[],
    scheduledTime: '19:00',
    intervalEnabled: true,
    timezone: 'America/Denver',
    titleConfig: null as TitleConfig | null,
  })

  const fetchChannels = useCallback(async () => {
    return adminFetch<Channel[]>('/channels', token)
  }, [token])

  const { data: channels, loading, error, refresh } = usePolling(fetchChannels, 10000, [token])

  const handleEdit = (channel: Channel) => {
    setEditingId(channel.id)
    setEditForm({ name: channel.name, description: channel.description || '', channelId: channel.channelId })
  }

  const handleSave = async (id: number) => {
    await adminFetch(`/channels/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ name: editForm.name, description: editForm.description, channelId: editForm.channelId }),
    })
    setEditingId(null)
    refresh()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this channel?')) return
    await adminFetch(`/channels/${id}`, token, { method: 'DELETE' })
    refresh()
  }

  const handleCreate = async () => {
    const channelId = prompt('Enter channel ID (e.g., scifi):')
    if (!channelId) return
    const name = prompt('Enter channel name:')
    if (!name) return
    const description = prompt('Enter description (optional):') || ''
    
    await adminFetch('/channels', token, {
      method: 'POST',
      body: JSON.stringify({ channelId, name, description }),
    })
    refresh()
  }

  const toggleDay = (day: string) => {
    setScheduleForm(prev => ({
      ...prev,
      scheduledDays: prev.scheduledDays.includes(day)
        ? prev.scheduledDays.filter(d => d !== day)
        : [...prev.scheduledDays, day],
    }))
  }

  const handleCreateSchedule = async (channelId: string) => {
    if (scheduleForm.scheduledDays.length === 0) {
      alert('Please select at least one day')
      return
    }
    
    if (!scheduleForm.titleConfig || !scheduleForm.titleConfig.programName) {
      alert('Please configure a title config (program name is required)')
      setShowTitleBuilder(true)
      return
    }
    
    await adminFetch('/schedules', token, {
      method: 'POST',
      body: JSON.stringify({
        channelId,
        scheduledDays: scheduleForm.scheduledDays,
        scheduledTime: scheduleForm.scheduledTime,
        intervalEnabled: scheduleForm.intervalEnabled,
        timezone: scheduleForm.timezone,
        titleConfig: scheduleForm.titleConfig,
      }),
    })
    setExpandedChannel(null)
    setShowTitleBuilder(false)
    setScheduleForm({
      scheduledDays: [],
      scheduledTime: '19:00',
      intervalEnabled: true,
      timezone: 'America/Denver',
      titleConfig: null,
    })
  }

  const handleUpdateSchedule = async (scheduleId: number) => {
    if (!scheduleForm.titleConfig || !scheduleForm.titleConfig.programName) {
      alert('Please configure a title config (program name is required)')
      setShowTitleBuilder(true)
      return
    }
    
    await adminFetch(`/schedules/${scheduleId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        scheduledDays: scheduleForm.scheduledDays,
        scheduledTime: scheduleForm.scheduledTime,
        intervalEnabled: scheduleForm.intervalEnabled,
        timezone: scheduleForm.timezone,
        titleConfig: scheduleForm.titleConfig,
      }),
    })
    setEditingScheduleId(null)
    setExpandedChannel(null)
    setShowTitleBuilder(false)
    setScheduleForm({
      scheduledDays: [],
      scheduledTime: '19:00',
      intervalEnabled: true,
      timezone: 'America/Denver',
      titleConfig: null,
    })
  }

  const handleDeleteSchedule = async (scheduleId: number) => {
    if (!confirm('Delete this schedule? Existing sessions will become one-off.')) return
    await adminFetch(`/schedules/${scheduleId}`, token, { method: 'DELETE' })
    setExpandedChannel(null)
  }

  const openEditSchedule = (schedule: Schedule) => {
    setExpandedChannel(schedule.channelId)
    setEditingScheduleId(schedule.id)
    setShowTitleBuilder(false)
    setScheduleForm({
      scheduledDays: schedule.scheduledDays || [],
      scheduledTime: schedule.scheduledTime || '19:00',
      intervalEnabled: schedule.intervalEnabled,
      timezone: schedule.timezone,
      titleConfig: (schedule as any).titleConfig || null,
    })
  }

  const openNewSchedule = (channelId: string, channelName: string) => {
    setExpandedChannel(channelId)
    setEditingScheduleId(null)
    setShowTitleBuilder(true)
    setScheduleForm({
      scheduledDays: [],
      scheduledTime: '19:00',
      intervalEnabled: true,
      timezone: 'America/Denver',
      titleConfig: {
        format: 'numbered',
        programName: channelName,
        sessionLabel: 'Day',
        subtitle: '',
        numberSource: 'episode',
        seasonSize: 30,
        showSeason: false,
        seasonLabel: 'S',
        inWorldTemplate: '{n} Days Before The Heist',
        inWorldMode: 'countup',
        inWorldTotal: 30,
      },
    })
  }

  return (
    <div className="p-4">
      <div className="flex gap-4 mb-4">
        <button
          onClick={refresh}
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh
        </button>
        <button
          onClick={handleCreate}
          className="text-sm text-green-600 hover:underline"
        >
          + Add Channel
        </button>
      </div>

      {loading && <p className="text-gray-500">Loading...</p>}
      {error && <p className="text-red-500">Error: {error.message}</p>}

      <div className="space-y-4">
        {channels?.map((channel) => (
          <div key={channel.id} className="border border-gray-200 rounded-lg p-4 bg-white">
            {editingId === channel.id ? (
               <div className="space-y-2">
                 <input
                   value={editForm.name}
                   onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                   className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                   placeholder="Name"
                 />
                 <input
                   value={editForm.description}
                   onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                   className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                   placeholder="Description"
                 />
                 <input
                   value={editForm.channelId}
                   onChange={(e) => setEditForm({ ...editForm, channelId: e.target.value })}
                   className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                   placeholder="Channel ID"
                 />
                 <div className="flex gap-2">
                   <button
                     onClick={() => handleSave(channel.id)}
                     className="text-xs text-green-600 hover:underline"
                   >
                     Save
                   </button>
                   <button
                     onClick={() => setEditingId(null)}
                     className="text-xs text-gray-500 hover:underline"
                   >
                     Cancel
                   </button>
                 </div>
               </div>
            ) : (
              <div>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">{channel.name}</div>
                    <div className="text-xs text-gray-500">ID: {channel.channelId}</div>
                    {channel.description && (
                      <div className="text-sm text-gray-600 mt-1">{channel.description}</div>
                    )}
                    <div className="text-xs text-gray-400 mt-1">
                        Created: { new Date(channel.createdAt ? channel.createdAt : '').toLocaleDateString() }
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(channel)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(channel.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-sm font-medium text-gray-700">Schedules</h4>
                    <button
                      onClick={() => openNewSchedule(channel.channelId, channel.name)}
                      className="text-xs text-green-600 hover:underline"
                    >
                      + Add Schedule
                    </button>
                  </div>
                  <ScheduleList 
                    channelId={channel.channelId} 
                    token={token}
                    onEdit={openEditSchedule}
                    onDelete={handleDeleteSchedule}
                  />
                </div>

                {expandedChannel === channel.channelId && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                    <h5 className="text-sm font-medium mb-3">
                      {editingScheduleId ? 'Edit Schedule' : 'New Schedule'}
                    </h5>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-gray-600 block mb-1">Days</label>
                        <div className="flex flex-wrap gap-2">
                          {DAYS.map((day) => (
                            <button
                              key={day}
                              onClick={() => toggleDay(day)}
                              className={`px-2 py-1 text-xs rounded border ${
                                scheduleForm.scheduledDays.includes(day)
                                  ? 'bg-blue-500 text-white border-blue-500'
                                  : 'bg-white text-gray-600 border-gray-300'
                              }`}
                            >
                              {day.slice(0, 3)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-600 block mb-1">Time (24h)</label>
                        <input
                          type="time"
                          value={scheduleForm.scheduledTime}
                          onChange={(e) => setScheduleForm(prev => ({ ...prev, scheduledTime: e.target.value }))}
                          className="border border-gray-300 rounded px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600 block mb-1">Timezone</label>
                        <select
                          value={scheduleForm.timezone}
                          onChange={(e) => setScheduleForm(prev => ({ ...prev, timezone: e.target.value }))}
                          className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                        >
                          {TIMEZONE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`interval-${channel.channelId}`}
                          checked={scheduleForm.intervalEnabled}
                          onChange={(e) => setScheduleForm(prev => ({ ...prev, intervalEnabled: e.target.checked }))}
                          className="rounded"
                        />
                        <label htmlFor={`interval-${channel.channelId}`} className="text-sm text-gray-600">
                          Enable recurring schedule
                        </label>
                      </div>
                      
                      <div className="border-t border-gray-200 pt-3 mt-3">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs text-gray-600">Title Config</label>
                          <button
                            type="button"
                            onClick={() => setShowTitleBuilder(!showTitleBuilder)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {showTitleBuilder ? 'Hide editor' : scheduleForm.titleConfig ? 'Edit title' : 'Configure title'}
                          </button>
                        </div>
                        
                        {scheduleForm.titleConfig ? (
                          <div className="bg-white border border-gray-200 rounded p-2 text-xs">
                            <div className="font-medium text-gray-700">
                              {getConfigPreview(scheduleForm.titleConfig)}
                            </div>
                            <div className="text-gray-400 mt-1 capitalize">
                              {scheduleForm.titleConfig.format?.replace('_', ' ')} · {scheduleForm.titleConfig.seasonSize ?? 30} per season
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 italic bg-gray-100 rounded p-2">
                            No title configured - required to create schedule
                          </div>
                        )}
                        
                        {showTitleBuilder && (
                          <div className="mt-3">
                            <TitleBuilder
                              initialConfig={scheduleForm.titleConfig}
                              onChange={(config) => setScheduleForm(prev => ({ ...prev, titleConfig: config }))}
                              onSave={() => setShowTitleBuilder(false)}
                              onCancel={() => setShowTitleBuilder(false)}
                            />
                          </div>
                        )}
                      </div>
                      
                      <div className="flex gap-2 pt-3">
                        <button
                          onClick={() => editingScheduleId 
                            ? handleUpdateSchedule(editingScheduleId) 
                            : handleCreateSchedule(channel.channelId)
                          }
                          className="text-xs text-green-600 hover:underline"
                        >
                          {editingScheduleId ? 'Update' : 'Create'}
                        </button>
                        <button
                          onClick={() => {
                            setExpandedChannel(null)
                            setEditingScheduleId(null)
                            setShowTitleBuilder(false)
                          }}
                          className="text-xs text-gray-500 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {channels?.length === 0 && !loading && (
        <p className="text-gray-500 mt-4">No channels found</p>
      )}
    </div>
  )
}

function ScheduleList({ 
  channelId, 
  token, 
  onEdit, 
  onDelete 
}: { 
  channelId: string
  token: string | undefined
  onEdit: (schedule: Schedule) => void
  onDelete: (scheduleId: number) => void
}) {
  const fetchSchedules = useCallback(async () => {
    return adminFetch<Schedule[]>(`/schedules?channelId=${channelId}`, token)
  }, [channelId, token])

  const { data: schedules } = usePolling(fetchSchedules, 10000, [channelId, token])

  if (!schedules || schedules.length === 0) {
    return <p className="text-xs text-gray-400">No schedules configured</p>
  }

  return (
    <div className="space-y-2">
      {schedules.map((schedule) => {
        const config = schedule.titleConfig as TitleConfig | null
        return (
          <div key={schedule.id} className="flex justify-between items-center p-2 bg-gray-50 rounded text-xs">
            <div>
              <span className="font-medium">#{schedule.id}</span>
              <span className="ml-2 text-gray-600">
                {schedule.scheduledDays?.map(d => d.slice(0, 3)).join(', ')} @ {schedule.scheduledTime}
              </span>
              <span className="ml-2 text-gray-400">({schedule.timezone})</span>
              {schedule.intervalEnabled ? (
                <span className="ml-2 text-green-600">Active</span>
              ) : (
                <span className="ml-2 text-gray-400">Disabled</span>
              )}
              {config ? (
                <div className="mt-1">
                  <span className="text-gray-500">{getConfigPreview(config)}</span>
                </div>
              ) : (
                <div className="mt-1 text-gray-400 italic">No title config</div>
              )}
              {schedule.nextRunAt && (
                <div className="text-gray-400 mt-1">
                  Next: {formatDisplayDate(schedule.nextRunAt, schedule.timezone)}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onEdit(schedule)}
                className="text-blue-600 hover:underline"
              >
                Edit
              </button>
              <button
                onClick={() => onDelete(schedule.id)}
                className="text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
