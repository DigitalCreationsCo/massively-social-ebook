import { useState, useCallback, useEffect } from 'react'
import { useAdminToken } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch } from '../../api/client';
import { Session, Channel } from '@shared/schema';
import { TIMEZONE_OPTIONS, utcToDatetimeLocal, formatDisplayDate } from '@shared/date';

export default function SessionsTab() {
  const { token } = useAdminToken()
  const [channelFilter, setChannelFilter] = useState<string>('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    scheduledStart: '',
    scheduledEnd: '',
    timezone: 'UTC',
    channelId: '',
    scheduleId: null as number | null,
  })
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState({
    title: '',
    description: '',
    channelId: '',
    scheduledStart: '',
    scheduledEnd: '',
    timezone: 'UTC',
    scheduleId: null as number | null,
  })

  const fetchChannels = useCallback(async () => {
    return adminFetch<Channel[]>('/channels', token)
  }, [token])

  const { data: channels } = usePolling(fetchChannels, 30000, [token])

  useEffect(() => {
    if (channels && channels.length > 0 && !createForm.channelId) {
      setCreateForm(prev => ({ ...prev, channelId: channels[0].channelId }))
    }
  }, [channels, createForm.channelId])

  const fetchSessions = useCallback(async () => {
    const query = new URLSearchParams()
    if (channelFilter) query.set('channelId', channelFilter)
    return adminFetch<Session[]>(`/sessions?${query}`, token)
  }, [token, channelFilter])

  const { data: sessions, loading, error, refresh, lastUpdated } = usePolling(fetchSessions, 10000, [token, channelFilter])

  const handleEdit = (session: Session) => {
    const tz = session.timezone || 'UTC'
    const scheduledStartDate = session.scheduledStart instanceof Date 
      ? session.scheduledStart 
      : new Date(session.scheduledStart)
    const scheduledEndDate = session.scheduledEnd instanceof Date
      ? session.scheduledEnd
      : new Date(session.scheduledEnd)
    
    setEditingId(session.id)
    setEditForm({
      title: session.title,
      description: session.description || '',
      scheduledStart: utcToDatetimeLocal(scheduledStartDate, tz),
      scheduledEnd: utcToDatetimeLocal(scheduledEndDate, tz),
      timezone: tz,
      channelId: session.channelId,
      scheduleId: session.scheduleId,
    })
  }

  const handleSave = async (id: number) => {
    await adminFetch(`/sessions/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        title: editForm.title,
        description: editForm.description,
        scheduledStart: editForm.scheduledStart,
        scheduledEnd: editForm.scheduledEnd,
        timezone: editForm.timezone,
        scheduleId: editForm.scheduleId,
      }),
    })
    setEditingId(null)
    refresh()
  }

  const handleCreate = async () => {
    if (!createForm.title || !createForm.scheduledStart || !createForm.scheduledEnd) {
      alert('Please fill in required fields: title, start time, and end time')
      return
    }
    
    await adminFetch('/sessions', token, {
      method: 'POST',
      body: JSON.stringify({
        title: createForm.title,
        description: createForm.description,
        channelId: createForm.channelId,
        scheduledStart: createForm.scheduledStart,
        scheduledEnd: createForm.scheduledEnd,
        timezone: createForm.timezone,
        scheduleId: createForm.scheduleId,
      }),
    })
    setShowCreateForm(false)
    setCreateForm({
      title: '',
      description: '',
      channelId: channels?.[0]?.channelId || '',
      scheduledStart: '',
      scheduledEnd: '',
      timezone: 'UTC',
      scheduleId: null,
    })
    refresh()
  }

  const handleCancel = async (id: number) => {
    if (!confirm('Cancel this session?')) return
    await adminFetch(`/sessions/${id}/cancel`, token, { method: 'PATCH' })
    refresh()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this session?')) return
    await adminFetch(`/sessions/${id}`, token, { method: 'DELETE' })
    refresh()
  }

  const formatDate = (date: string | Date, tz?: string) => {
    if (tz) {
      return formatDisplayDate(date, tz)
    }
    const d = date instanceof Date ? date : new Date(date)
    return d.toLocaleString()
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'text-blue-600 bg-blue-50'
      case 'active': return 'text-green-600 bg-green-50'
      case 'completed': return 'text-gray-600 bg-gray-50'
      case 'cancelled': return 'text-red-600 bg-red-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const channelOptions = channels || []

  return (
    <div className="p-4">
      <div className="flex gap-4 mb-4 items-center flex-wrap">
        <label className="text-sm">
          Channel:
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">All</option>
            {channelOptions.map(ch => (
              <option key={ch.id} value={ch.channelId}>{ch.name}</option>
            ))}
          </select>
        </label>
        <button
          onClick={refresh}
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh
        </button>
        <button
          onClick={() => setShowCreateForm(true)}
          className="text-sm text-green-600 hover:underline"
        >
          + New Session
        </button>
        {lastUpdated && (
          <span className="text-xs text-gray-400">
            Updated: {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {showCreateForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="text-sm font-medium mb-3">Create New Session</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Title *</label>
              <input
                type="text"
                value={createForm.title}
                onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="Session title"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Channel</label>
              <select
                value={createForm.channelId}
                onChange={(e) => setCreateForm({ ...createForm, channelId: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
              >
                {channelOptions.map(ch => (
                  <option key={ch.id} value={ch.channelId}>{ch.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Start *</label>
              <input
                type="datetime-local"
                value={createForm.scheduledStart}
                onChange={(e) => setCreateForm({ ...createForm, scheduledStart: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">End *</label>
              <input
                type="datetime-local"
                value={createForm.scheduledEnd}
                onChange={(e) => setCreateForm({ ...createForm, scheduledEnd: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Timezone *</label>
              <select
                value={createForm.timezone}
                onChange={(e) => setCreateForm({ ...createForm, timezone: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
              >
                {TIMEZONE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Description</label>
              <input
                type="text"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="Optional description"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleCreate}
              className="text-xs text-green-600 hover:underline"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="text-xs text-gray-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <p className="text-gray-500">Loading...</p>}
      {error && <p className="text-red-500">Error: {error.message}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2">ID</th>
              <th className="text-left py-2 px-2">Channel</th>
              <th className="text-left py-2 px-2">Title</th>
              <th className="text-left py-2 px-2">Start</th>
              <th className="text-left py-2 px-2">End</th>
              <th className="text-left py-2 px-2">Timezone</th>
              <th className="text-left py-2 px-2">Status</th>
              <th className="text-left py-2 px-2">Schedule ID</th>
              <th className="text-left py-2 px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions?.map((session) => (
              <tr key={session.id} className="border-b border-gray-100 hover:bg-gray-50">
                {editingId === session.id ? (
                  <>
                    <td className="py-2 px-2">{session.id}</td>
                    <td className="py-2 px-2">
                      <select
                        value={editForm.channelId}
                        onChange={(e) => setEditForm({ ...editForm, channelId: e.target.value })}
                        className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full"
                      >
                        {channelOptions.map(ch => (
                          <option key={ch.id} value={ch.channelId}>{ch.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                        className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="datetime-local"
                        value={editForm.scheduledStart}
                        onChange={(e) => setEditForm({ ...editForm, scheduledStart: e.target.value })}
                        className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="datetime-local"
                        value={editForm.scheduledEnd}
                        onChange={(e) => setEditForm({ ...editForm, scheduledEnd: e.target.value })}
                        className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <select
                        value={editForm.timezone}
                        onChange={(e) => setEditForm({ ...editForm, timezone: e.target.value })}
                        className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full"
                      >
                        {TIMEZONE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${statusColor(session.status)}`}>
                        {session.status}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-xs">
                      {session.scheduleId ? (
                        <span className="text-gray-600">#{session.scheduleId}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <button
                        onClick={() => handleSave(session.id)}
                        className="text-xs text-green-600 hover:underline mr-2"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-2 px-2">{session.id}</td>
                    <td className="py-2 px-2">{session.channelId}</td>
                    <td className="py-2 px-2 font-medium">{session.title}</td>
                    <td className="py-2 px-2">{formatDate(session.scheduledStart, session.timezone)}</td>
                    <td className="py-2 px-2">{formatDate(session.scheduledEnd, session.timezone)}</td>
                    <td className="py-2 px-2">{session.timezone}</td>
                    <td className="py-2 px-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${statusColor(session.status)}`}>
                        {session.status}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-xs">
                      {session.scheduleId ? (
                        <span className="text-gray-600">#{session.scheduleId}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <button
                        onClick={() => handleEdit(session)}
                        className="text-xs text-blue-600 hover:underline mr-2"
                      >
                        Edit
                      </button>
                      {session.status === 'scheduled' && (
                        <button
                          onClick={() => handleCancel(session.id)}
                          className="text-xs text-red-600 hover:underline mr-2"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(session.id)}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sessions?.length === 0 && !loading && (
        <p className="text-gray-500 mt-4">No sessions found</p>
      )}
    </div>
  )
}
