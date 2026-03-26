import { useState, useCallback } from 'react'
import { useAdminToken } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch, type Lore } from '../../api/client'

export default function LoreTab() {
  const { token } = useAdminToken()
  const [channelFilter, setChannelFilter] = useState<string>('')

  const fetchLore = useCallback(async () => {
    const query = channelFilter ? `?channelId=${channelFilter}` : ''
    return adminFetch<Lore[]>(`/lore${query}`, token)
  }, [token, channelFilter])

  const { data: lore, loading, error, refresh } = usePolling(fetchLore, 10000, [token, channelFilter])

  const handleDelete = async (id: number) => {
    if (!confirm('Deactivate this lore entry?')) return
    await adminFetch(`/lore/${id}`, token, { method: 'DELETE' })
    refresh()
  }

  const handleCreate = async () => {
    const channelId = prompt('Channel ID (e.g., scifi):')
    if (!channelId) return
    const content = prompt('Lore content:')
    if (!content) return

    await adminFetch('/lore', token, {
      method: 'POST',
      body: JSON.stringify({ channelId, content }),
    })
    refresh()
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
        <button
          onClick={handleCreate}
          className="text-sm text-green-600 hover:underline"
        >
          + Add Lore
        </button>
      </div>

      {loading && <p className="text-gray-500">Loading...</p>}
      {error && <p className="text-red-500">Error: {error.message}</p>}

      <div className="space-y-2">
        {lore?.map((item) => (
          <div key={item.id} className="border border-gray-200 rounded p-3 bg-white">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-500">{item.channelId}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${item.isActive ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
                    {item.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="text-sm whitespace-pre-wrap">{item.content}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(item.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => handleDelete(item.id)}
                className="text-xs text-red-600 hover:underline ml-2"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {lore?.length === 0 && !loading && (
        <p className="text-gray-500 mt-4">No lore entries found</p>
      )}
    </div>
  )
}
