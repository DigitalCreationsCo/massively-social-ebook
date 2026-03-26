import { useState, useCallback } from 'react'
import { useAdminToken } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch, type Session } from '../../api/client'

export default function SessionsTab() {
  const { token } = useAdminToken()
  const [channelFilter, setChannelFilter] = useState<string>('')

  const fetchSessions = useCallback(async () => {
    const query = new URLSearchParams()
    if (channelFilter) query.set('channelId', channelFilter)
    return adminFetch<Session[]>(`/sessions?${query}`, token)
  }, [token, channelFilter])

  const { data: sessions, loading, error, refresh, lastUpdated } = usePolling(fetchSessions, 10000, [token, channelFilter])

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

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString()
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

  return (
    <div className="p-4">
      <div className="flex gap-4 mb-4 items-center">
        <label className="text-sm">
          Channel:
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">All</option>
            <option value="scifi">Sci-Fi</option>
            <option value="mystery">Mystery</option>
          </select>
        </label>
        <button
          onClick={refresh}
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh
        </button>
        {lastUpdated && (
          <span className="text-xs text-gray-400">
            Updated: {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

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
              <th className="text-left py-2 px-2">Status</th>
              <th className="text-left py-2 px-2">Schedule</th>
              <th className="text-left py-2 px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions?.map((session) => (
              <tr key={session.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-2">{session.id}</td>
                <td className="py-2 px-2">{session.channelId}</td>
                <td className="py-2 px-2 font-medium">{session.title}</td>
                <td className="py-2 px-2">{formatDate(session.scheduledStart)}</td>
                <td className="py-2 px-2">{formatDate(session.scheduledEnd)}</td>
                <td className="py-2 px-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${statusColor(session.status)}`}>
                    {session.status}
                  </span>
                </td>
                <td className="py-2 px-2 text-xs">
                  {session.intervalEnabled && session.scheduledDays ? (
                    <span>{session.scheduledDays.join(', ')} @ {session.scheduledTime}</span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="py-2 px-2">
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
