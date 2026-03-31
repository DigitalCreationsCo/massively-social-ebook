import { useState, useCallback, useEffect } from 'react'
import { useAdminToken } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch } from '../../api/client';
import { Lore, Channel } from '@shared/schema'

export default function LoreTab() {
  const { token } = useAdminToken()
  const [channelFilter, setChannelFilter] = useState<string>('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState({
    channelId: '',
    content: ''
  })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({
    channelId: '',
    content: '',
    isActive: true
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

  const handleEdit = (item: Lore) => {
    setEditingId(item.id)
    setEditForm({
      channelId: item.channelId,
      content: item.content,
      isActive: item.isActive ?? true
    })
  }

  const handleSave = async (id: number) => {
    await adminFetch(`/lore/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(editForm),
    })
    setEditingId(null)
    refresh()
  }

  const handleCreate = async () => {
    if (!createForm.channelId || !createForm.content) {
      alert('Please fill in all fields')
      return
    }

    await adminFetch('/lore', token, {
      method: 'POST',
      body: JSON.stringify(createForm),
    })
    setShowCreateForm(false)
    setCreateForm({
      channelId: channels?.[0]?.channelId || '',
      content: ''
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
            {channels?.map(ch => (
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
          + Add Lore
        </button>
      </div>

      {showCreateForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="text-sm font-medium mb-3">Add New Lore</h3>
          <div className="space-y-3 text-sm">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Channel *</label>
              <select
                value={createForm.channelId}
                onChange={(e) => setCreateForm({ ...createForm, channelId: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full max-w-xs"
              >
                {channels?.map(ch => (
                  <option key={ch.id} value={ch.channelId}>{ch.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Content *</label>
              <textarea
                value={createForm.content}
                onChange={(e) => setCreateForm({ ...createForm, content: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full h-24"
                placeholder="Enter lore content..."
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

      <div className="space-y-2">
        {lore?.map((item) => (
          <div key={item.id} className="border border-gray-200 rounded p-3 bg-white">
            {editingId === item.id ? (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <select
                    value={editForm.channelId}
                    onChange={(e) => setEditForm({ ...editForm, channelId: e.target.value })}
                    className="border border-gray-300 rounded px-2 py-1 text-sm max-w-xs"
                  >
                    {channels?.map(ch => (
                      <option key={ch.id} value={ch.channelId}>{ch.name}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editForm.isActive}
                      onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                    />
                    Active
                  </label>
                </div>
                <textarea
                  value={editForm.content}
                  onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                  className="border border-gray-300 rounded px-2 py-1 w-full h-24 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSave(item.id)}
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
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-500">{item.channelId}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${item.isActive ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
                      {item.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{item.content}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    { new Date(item.createdAt ? item.createdAt : '').toLocaleDateString() }
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleEdit(item)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
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

      {lore?.length === 0 && !loading && (
        <p className="text-gray-500 mt-4">No lore entries found</p>
      )}
    </div>
  )
}
