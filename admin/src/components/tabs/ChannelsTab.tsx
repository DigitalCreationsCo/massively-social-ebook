import { useState, useCallback } from 'react'
import { useAdminToken } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch, type Channel } from '../../api/client'

export default function ChannelsTab() {
  const { token } = useAdminToken()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ name: '', description: '' })

  const fetchChannels = useCallback(async () => {
    return adminFetch<Channel[]>('/channels', token)
  }, [token])

  const { data: channels, loading, error, refresh } = usePolling(fetchChannels, 10000, [token])

  const handleEdit = (channel: Channel) => {
    setEditingId(channel.id)
    setEditForm({ name: channel.name, description: channel.description || '' })
  }

  const handleSave = async (id: number) => {
    await adminFetch(`/channels/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(editForm),
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

      <div className="space-y-2">
        {channels?.map((channel) => (
          <div key={channel.id} className="border border-gray-200 rounded p-3 bg-white">
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
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">{channel.name}</div>
                  <div className="text-xs text-gray-500">ID: {channel.channelId}</div>
                  {channel.description && (
                    <div className="text-sm text-gray-600 mt-1">{channel.description}</div>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    Created: {new Date(channel.createdAt).toLocaleDateString()}
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
