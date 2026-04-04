import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAdminToken } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch } from '../../api/client';
import { Session, Channel } from '@shared/schema';
import { TIMEZONE_OPTIONS, formatInTimeZone } from '@shared/date';
import { ArrowUpDown, ArrowUp, ArrowDown, X } from 'lucide-react';

interface SessionFilters {
  status: string
  channelId: string
  search: string
}

type SortField = 'id' | 'title' | 'channelId' | 'scheduledStart' | 'scheduledEnd' | 'status' | 'createdAt'
type SortDirection = 'asc' | 'desc'

interface SortConfig {
  field: SortField
  direction: SortDirection
}

const getLocalTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

const formatDateForDisplay = (date: string | Date, tz: string): string => {
  try {
    return formatInTimeZone(new Date(date), tz, "MMM d, yyyy 'at' h:mm a")
  } catch {
    return '—'
  }
}

const formatDateForHover = (date: string | Date): string => {
  try {
    return formatInTimeZone(new Date(date), 'UTC', "yyyy-MM-dd HH:mm 'UTC'")
  } catch {
    return '—'
  }
}

const formatRelativeTime = (date: string | Date | null): string => {
  if (!date) return '—'
  try {
    const now = new Date()
    const d = new Date(date)
    if (isNaN(d.getTime())) return '—'
    
    const diffMs = d.getTime() - now.getTime()
    const diffMins = Math.round(diffMs / 60000)
    const absMins = Math.abs(diffMins)
    const diffHours = Math.round(diffMs / 3600000)
    const absHours = Math.abs(diffHours)
    const diffDays = Math.round(diffMs / 86400000)
    const absDays = Math.abs(diffDays)
    
    if (diffMs < 0) {
      if (absMins < 60) return `${absMins}m ago`
      if (absHours < 24) return `${absHours}h ago`
      return `${absDays}d ago`
    } else {
      if (absMins < 60) return `in ${absMins}m`
      if (absHours < 24) return `in ${absHours}h`
      return `in ${absDays}d`
    }
  } catch {
    return '—'
  }
}

export default function SessionsTab() {
  const { token } = useAdminToken()
  const parentRef = useRef<HTMLDivElement>(null)
  
  // Filters
  const [filters, setFilters] = useState<SessionFilters>({
    status: '',
    channelId: '',
    search: '',
  })
  
  // Sort
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: 'scheduledStart',
    direction: 'desc',
  })
  
  // Local timezone
  const [localTimezone] = useState(() => getLocalTimezone())
  
  // Editing state
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

  // Fetch channels
  const fetchChannels = useCallback(async () => {
    return adminFetch<Channel[]>('/channels', token)
  }, [token])

  const { data: channels } = usePolling(fetchChannels, 30000, [token])

  useEffect(() => {
    if (channels && channels.length > 0) {
      setCreateForm(prev => {
        if (!prev.channelId) {
          return { ...prev, channelId: channels[0].channelId }
        }
        return prev
      })
    }
  }, [channels])

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    const query = new URLSearchParams()
    if (filters.channelId) query.set('channelId', filters.channelId)
    return adminFetch<Session[]>(`/sessions?${query}`, token)
  }, [token, filters.channelId])

  const { data: sessions, loading, error, refresh, lastUpdated } = usePolling(
    fetchSessions, 
    10000, 
    [token, filters.channelId]
  )

  // ─── Filtering & Sorting (Client-side for scalability) ───────────────────────

  const filteredAndSortedSessions = useMemo(() => {
    if (!sessions) return []
    
    let result = [...sessions]
    
    // Apply filters
    if (filters.status) {
      result = result.filter(s => s.status === filters.status)
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      result = result.filter(s => 
        s.title.toLowerCase().includes(searchLower) ||
        s.channelId.toLowerCase().includes(searchLower) ||
        (s.description?.toLowerCase().includes(searchLower))
      )
    }
    
    // Apply sorting
    result.sort((a, b) => {
      let aVal: any, bVal: any
      
      switch (sortConfig.field) {
        case 'id':
          aVal = a.id
          bVal = b.id
          break
        case 'title':
          aVal = a.title
          bVal = b.title
          break
        case 'channelId':
          aVal = a.channelId
          bVal = b.channelId
          break
        case 'scheduledStart':
          aVal = new Date(a.scheduledStart).getTime()
          bVal = new Date(b.scheduledStart).getTime()
          break
        case 'scheduledEnd':
          aVal = new Date(a.scheduledEnd).getTime()
          bVal = new Date(b.scheduledEnd).getTime()
          break
        case 'status':
          aVal = a.status
          bVal = b.status
          break
        case 'createdAt':
          aVal = new Date(a.createdAt || 0).getTime()
          bVal = new Date(b.createdAt || 0).getTime()
          break
        default:
          return 0
      }
      
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })
    
    return result
  }, [sessions, filters, sortConfig])

  // Virtual list
  const rowVirtualizer = useVirtualizer({
    count: filteredAndSortedSessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  })

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleSort = (field: SortField) => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

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
      scheduledStart: formatInTimeZone(scheduledStartDate, tz, "yyyy-MM-dd'T'HH:mm"),
      scheduledEnd: formatInTimeZone(scheduledEndDate, tz, "yyyy-MM-dd'T'HH:mm"),
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
      channelId: createForm.channelId,
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

  const clearFilters = () => {
    setFilters({ status: '', channelId: '', search: '' })
  }

  const hasActiveFilters = filters.status || filters.channelId || filters.search

  // Render helpers
  const statusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'text-blue-600 bg-blue-50'
      case 'active': return 'text-green-600 bg-green-50'
      case 'completed': return 'text-gray-600 bg-gray-50'
      case 'cancelled': return 'text-red-600 bg-red-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortConfig.field !== field) {
      return <ArrowUpDown className="w-3 h-3 inline ml-1 opacity-30" />
    }
    return sortConfig.direction === 'asc' 
      ? <ArrowUp className="w-3 h-3 inline ml-1" />
      : <ArrowDown className="w-3 h-3 inline ml-1" />
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex gap-3 mb-4 items-center flex-wrap">
        {/* Search */}
        <input
          type="text"
          placeholder="Search sessions..."
          value={filters.search}
          onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
          className="border border-gray-300 rounded px-2 py-1 text-sm w-48"
        />
        
        {/* Status Filter */}
        <select
          value={filters.status}
          onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        
        {/* Channel Filter */}
        <select
          value={filters.channelId}
          onChange={(e) => setFilters(prev => ({ ...prev, channelId: e.target.value }))}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="">All Channels</option>
          {(channels || []).map(ch => (
            <option key={ch.id} value={ch.channelId}>{ch.name}</option>
          ))}
        </select>
        
        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
        
        <div className="flex-1" />
        
        {/* Timezone Info */}
        <span className="text-xs text-gray-400">
          Local: {localTimezone}
        </span>
        
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
                {(channels || []).map(ch => (
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

      {/* Results count */}
      <div className="text-xs text-gray-400 mb-2">
        Showing {filteredAndSortedSessions.length.toLocaleString()} of {sessions?.length.toLocaleString() || 0} sessions
      </div>

      {/* Virtual Table */}
      <div 
        ref={parentRef} 
        className="flex-1 overflow-auto border border-gray-200 rounded-lg"
      >
        {filteredAndSortedSessions.length > 0 ? (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-zinc-900 z-10">
              <tr className="border-b border-gray-700">
                <th 
                  className="text-left py-2 px-2 cursor-pointer hover:text-white"
                  onClick={() => handleSort('id')}
                >
                  ID <SortIcon field="id" />
                </th>
                <th 
                  className="text-left py-2 px-2 cursor-pointer hover:text-white"
                  onClick={() => handleSort('channelId')}
                >
                  Channel <SortIcon field="channelId" />
                </th>
                <th 
                  className="text-left py-2 px-2 cursor-pointer hover:text-white"
                  onClick={() => handleSort('title')}
                >
                  Title <SortIcon field="title" />
                </th>
                <th 
                  className="text-left py-2 px-2 cursor-pointer hover:text-white"
                  onClick={() => handleSort('scheduledStart')}
                >
                  Start <SortIcon field="scheduledStart" />
                </th>
                <th 
                  className="text-left py-2 px-2 cursor-pointer hover:text-white"
                  onClick={() => handleSort('scheduledEnd')}
                >
                  End <SortIcon field="scheduledEnd" />
                </th>
                <th className="text-left py-2 px-2">Timezone</th>
                <th 
                  className="text-left py-2 px-2 cursor-pointer hover:text-white"
                  onClick={() => handleSort('status')}
                >
                  Status <SortIcon field="status" />
                </th>
                <th className="text-left py-2 px-2">Schedule ID</th>
                <th className="text-left py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const session = filteredAndSortedSessions[virtualRow.index]
                return (
                  <tr 
                    key={session.id} 
                    className="border-b border-gray-100 hover:bg-gray-50"
                    style={{
                      height: `${virtualRow.size}px`,
                    }}
                  >
                    {editingId === session.id ? (
                      <>
                        <td className="py-2 px-2">{session.id}</td>
                        <td className="py-2 px-2">
                          <select
                            value={editForm.channelId}
                            onChange={(e) => setEditForm({ ...editForm, channelId: e.target.value })}
                            className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {(channels || []).map(ch => (
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
                        <td className="py-2 px-2">
                          <div className="text-xs" title={formatDateForHover(session.scheduledStart)}>
                            {formatDateForDisplay(session.scheduledStart, session.timezone || 'UTC')}
                          </div>
                          <div className="text-xs text-gray-400">
                            {formatRelativeTime(session.scheduledStart)}
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <div className="text-xs" title={formatDateForHover(session.scheduledEnd)}>
                            {formatDateForDisplay(session.scheduledEnd, session.timezone || 'UTC')}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-xs">{session.timezone}</td>
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
                )
              })}
            </tbody>
          </table>
        ) : (
          <div className="flex items-center justify-center h-32 text-gray-500">
            {hasActiveFilters 
              ? 'No sessions match the current filters' 
              : 'No sessions found'}
          </div>
        )}
      </div>
    </div>
  )
}
