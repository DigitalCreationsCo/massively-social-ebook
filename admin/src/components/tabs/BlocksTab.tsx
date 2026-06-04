import { useState, useCallback, useEffect } from 'react'
import { useAdminToken } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch } from '../../api/client';
import { Channel } from '@shared/schema'

interface BlockOption {
  label?: string
  description?: string
}

interface Block {
  id: number
  channelId: string
  sessionId: number
  title: string | null
  content: string
  imageUrl: string | null
  optionA: BlockOption | null
  optionB: BlockOption | null
  isNotable: boolean
  createdAt: Date | string
}

interface Session {
  id: number
  title: string
  channelId: string
  scheduledStart: Date | string
  status: string
}

interface CreateBlockForm {
  channelId: string
  sessionId: string
  title: string
  content: string
  imageUrl: string
  optionALabel: string
  optionADescription: string
  optionBLabel: string
  optionBDescription: string
  isNotable: boolean
}

function formatDate(dateValue: unknown): string {
  if (!dateValue) return '--'
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue as string)
  if (isNaN(date.getTime())) return '--'
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function BlocksTab() {
  const { token } = useAdminToken()
  const [channelFilter, setChannelFilter] = useState<string>('')
  const [sessionFilter, setSessionFilter] = useState<string>('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [expandedOptions, setExpandedOptions] = useState<number | null>(null)

  const [createForm, setCreateForm] = useState<CreateBlockForm>({
    channelId: '',
    sessionId: '',
    title: '',
    content: '',
    imageUrl: '',
    optionALabel: '',
    optionADescription: '',
    optionBLabel: '',
    optionBDescription: '',
    isNotable: false,
  })

  const [editForm, setEditForm] = useState({
    title: '',
    content: '',
    imageUrl: '',
    optionALabel: '',
    optionADescription: '',
    optionBLabel: '',
    optionBDescription: '',
    isNotable: false,
  })

  // ── Inject Next Block (pending-block creation) ──────────────────────────────
  const [injectForId, setInjectForId] = useState<number | null>(null)
  const [injectForm, setInjectForm] = useState({
    choice: 'A' as 'A' | 'B',
    title: '',
    content: '',
    dialogue: '',
    imageUrl: '',
    optionALabel: '',
    optionADescription: '',
    optionBLabel: '',
    optionBDescription: '',
  })
  const [injectStatus, setInjectStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')

  const handleInjectOpen = (block: Block) => {
    setInjectForId(block.id)
    setInjectForm({
      choice: 'A',
      title: block.title ?? '',
      content: '',
      dialogue: '',
      imageUrl: block.imageUrl ?? '',
      optionALabel: block.optionA?.label ?? '',
      optionADescription: block.optionA?.description ?? '',
      optionBLabel: block.optionB?.label ?? '',
      optionBDescription: block.optionB?.description ?? '',
    })
    setInjectStatus('idle')
  }

  const handleInjectCancel = () => {
    setInjectForId(null)
    setInjectStatus('idle')
  }

  const handleInject = async () => {
    if (!injectForId || !injectForm.content) {
      alert('Content is required to inject a pending block.')
      return
    }

    const block = blocks?.find(b => b.id === injectForId)
    if (!block) {
      alert('Block not found. Has the list changed?')
      return
    }

    setInjectStatus('saving')

    const payload: Record<string, unknown> = {
      forBlockId: injectForId,
      choice: injectForm.choice,
      channelId: block.channelId,
      content: injectForm.content,
      title: injectForm.title || null,
      dialogue: injectForm.dialogue || null,
      imageUrl: injectForm.imageUrl || null,
    }

    if (injectForm.optionALabel || injectForm.optionADescription) {
      payload.optionA = {
        label: injectForm.optionALabel || null,
        description: injectForm.optionADescription || null,
      }
    }

    if (injectForm.optionBLabel || injectForm.optionBDescription) {
      payload.optionB = {
        label: injectForm.optionBLabel || null,
        description: injectForm.optionBDescription || null,
      }
    }

    try {
      await adminFetch('/pending-blocks', token, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setInjectStatus('done')
      setTimeout(() => {
        setInjectForId(null)
        setInjectStatus('idle')
      }, 1500)
      refresh()
    } catch (err) {
      setInjectStatus('error')
      alert(`Failed to inject pending block: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

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
    if (!channelFilter) return []
    const sessions = await adminFetch<Session[]>(`/sessions?channelId=${channelFilter}`, token)
    return sessions.filter(s => s.status === 'active' || s.status === 'scheduled')
  }, [token, channelFilter])

  const { data: activeSessions } = usePolling(fetchSessions, 15000, [token, channelFilter])

  const fetchBlocks = useCallback(async () => {
    const params = new URLSearchParams()
    if (channelFilter) params.append('channelId', channelFilter)
    const query = params.toString() ? `?${params.toString()}` : ''
    const blocks = await adminFetch<Block[]>(`/blocks${query}`, token)
    if (sessionFilter) {
      return blocks.filter(b => b.sessionId === parseInt(sessionFilter))
    }
    return blocks
  }, [token, channelFilter, sessionFilter])

  const { data: blocks, loading, error, refresh } = usePolling(fetchBlocks, 15000, [token, channelFilter, sessionFilter])

  const handleCreate = async () => {
    if (!createForm.channelId || !createForm.sessionId || !createForm.content) {
      alert('Please fill in required fields: Channel, Session, and Content')
      return
    }

    const payload: Record<string, unknown> = {
      channelId: createForm.channelId,
      sessionId: parseInt(createForm.sessionId),
      content: createForm.content,
      title: createForm.title || null,
      imageUrl: createForm.imageUrl || null,
      isNotable: createForm.isNotable,
    }

    if (createForm.optionALabel || createForm.optionADescription) {
      payload.optionA = {
        label: createForm.optionALabel || null,
        description: createForm.optionADescription || null,
      }
    }

    if (createForm.optionBLabel || createForm.optionBDescription) {
      payload.optionB = {
        label: createForm.optionBLabel || null,
        description: createForm.optionBDescription || null,
      }
    }

    try {
      await adminFetch('/blocks', token, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setShowCreateForm(false)
      setCreateForm({
        channelId: channels?.[0]?.channelId || '',
        sessionId: '',
        title: '',
        content: '',
        imageUrl: '',
        optionALabel: '',
        optionADescription: '',
        optionBLabel: '',
        optionBDescription: '',
        isNotable: false,
      })
      refresh()
    } catch (err) {
      alert(`Failed to create block: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleEdit = (block: Block) => {
    setEditingId(block.id)
    setEditForm({
      title: block.title || '',
      content: block.content,
      imageUrl: block.imageUrl || '',
      optionALabel: block.optionA?.label || '',
      optionADescription: block.optionA?.description || '',
      optionBLabel: block.optionB?.label || '',
      optionBDescription: block.optionB?.description || '',
      isNotable: block.isNotable,
    })
  }

  const handleSave = async (id: number) => {
    const payload: Record<string, unknown> = {
      content: editForm.content,
    }

    if (editForm.title !== undefined) payload.title = editForm.title || null
    if (editForm.imageUrl !== undefined) payload.imageUrl = editForm.imageUrl || null
    if (editForm.isNotable !== undefined) payload.isNotable = editForm.isNotable

    if (editForm.optionALabel || editForm.optionADescription) {
      payload.optionA = {
        label: editForm.optionALabel || null,
        description: editForm.optionADescription || null,
      }
    } else {
      payload.optionA = null
    }

    if (editForm.optionBLabel || editForm.optionBDescription) {
      payload.optionB = {
        label: editForm.optionBLabel || null,
        description: editForm.optionBDescription || null,
      }
    } else {
      payload.optionB = null
    }

    try {
      await adminFetch(`/blocks/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setEditingId(null)
      refresh()
    } catch (err) {
      alert(`Failed to update block: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleToggleNotable = async (block: Block) => {
    try {
      await adminFetch(`/blocks/${block.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ isNotable: !block.isNotable }),
      })
      refresh()
    } catch (err) {
      alert(`Failed to toggle notable: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this block? This cannot be undone.')) return
    try {
      await adminFetch(`/blocks/${id}`, token, { method: 'DELETE' })
      refresh()
    } catch (err) {
      alert(`Failed to delete block: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const getChannelName = (channelId: string) => {
    return channels?.find(c => c.channelId === channelId)?.name || channelId
  }

  const getSessionTitle = (sessionId: number) => {
    return activeSessions?.find(s => s.id === sessionId)?.title || `Session #${sessionId}`
  }

  return (
    <div className="p-4">
      <div className="flex gap-4 mb-4 items-center flex-wrap">
        <label className="text-sm">
          Channel:
          <select
            value={channelFilter}
            onChange={(e) => {
              setChannelFilter(e.target.value)
              setSessionFilter('')
            }}
            className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">All Channels</option>
            {channels?.map(ch => (
              <option key={ch.id} value={ch.channelId}>{ch.name}</option>
            ))}
          </select>
        </label>

        {channelFilter && (
          <label className="text-sm">
            Session:
            <select
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="">All Sessions</option>
              {activeSessions?.map(s => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </label>
        )}

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
          + New Block
        </button>

        {blocks && (
          <span className="text-sm text-gray-500">
            {blocks.length} block{blocks.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {showCreateForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="text-sm font-medium mb-3">Create New Block</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Channel *</label>
              <select
                value={createForm.channelId}
                onChange={(e) => setCreateForm({ ...createForm, channelId: e.target.value, sessionId: '' })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
              >
                {channels?.map(ch => (
                  <option key={ch.id} value={ch.channelId}>{ch.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">Session *</label>
              <select
                value={createForm.sessionId}
                onChange={(e) => setCreateForm({ ...createForm, sessionId: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                disabled={!createForm.channelId}
              >
                <option value="">Select session...</option>
                {activeSessions?.filter(s => s.channelId === createForm.channelId).map(s => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Title</label>
              <input
                type="text"
                value={createForm.title}
                onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="Optional title..."
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Content *</label>
              <textarea
                value={createForm.content}
                onChange={(e) => setCreateForm({ ...createForm, content: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full h-24"
                placeholder="Story content..."
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Image URL</label>
              <input
                type="text"
                value={createForm.imageUrl}
                onChange={(e) => setCreateForm({ ...createForm, imageUrl: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="https://..."
              />
            </div>

            <div className="col-span-2 font-medium text-xs text-gray-500 mt-2">Choice A</div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Option A Label</label>
              <input
                type="text"
                value={createForm.optionALabel}
                onChange={(e) => setCreateForm({ ...createForm, optionALabel: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="e.g., 'Take the left path'"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Option A Description</label>
              <input
                type="text"
                value={createForm.optionADescription}
                onChange={(e) => setCreateForm({ ...createForm, optionADescription: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="Brief description..."
              />
            </div>

            <div className="col-span-2 font-medium text-xs text-gray-500 mt-2">Choice B</div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Option B Label</label>
              <input
                type="text"
                value={createForm.optionBLabel}
                onChange={(e) => setCreateForm({ ...createForm, optionBLabel: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="e.g., 'Take the right path'"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Option B Description</label>
              <input
                type="text"
                value={createForm.optionBDescription}
                onChange={(e) => setCreateForm({ ...createForm, optionBDescription: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="Brief description..."
              />
            </div>

            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createForm.isNotable}
                  onChange={(e) => setCreateForm({ ...createForm, isNotable: e.target.checked })}
                  className="rounded"
                />
                Mark as Notable Moment
              </label>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreate}
              className="text-sm text-green-600 hover:underline"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="text-sm text-gray-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <p className="text-gray-500">Loading...</p>}
      {error && <p className="text-red-500">Error: {error.message}</p>}

      <div className="space-y-2">
        {blocks?.map((block) => (
          <div key={block.id} className="border border-gray-200 rounded p-3 bg-white">
            {editingId === block.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-600 mb-1">Title</label>
                    <input
                      type="text"
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1 w-full"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-600 mb-1">Content *</label>
                    <textarea
                      value={editForm.content}
                      onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1 w-full h-20"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-600 mb-1">Image URL</label>
                    <input
                      type="text"
                      value={editForm.imageUrl}
                      onChange={(e) => setEditForm({ ...editForm, imageUrl: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1 w-full"
                    />
                  </div>

                  <div className="col-span-2 font-medium text-xs text-gray-500">Option A</div>
                  <div>
                    <input
                      type="text"
                      value={editForm.optionALabel}
                      onChange={(e) => setEditForm({ ...editForm, optionALabel: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1 w-full"
                      placeholder="Label"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={editForm.optionADescription}
                      onChange={(e) => setEditForm({ ...editForm, optionADescription: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1 w-full"
                      placeholder="Description"
                    />
                  </div>

                  <div className="col-span-2 font-medium text-xs text-gray-500">Option B</div>
                  <div>
                    <input
                      type="text"
                      value={editForm.optionBLabel}
                      onChange={(e) => setEditForm({ ...editForm, optionBLabel: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1 w-full"
                      placeholder="Label"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={editForm.optionBDescription}
                      onChange={(e) => setEditForm({ ...editForm, optionBDescription: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1 w-full"
                      placeholder="Description"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editForm.isNotable}
                        onChange={(e) => setEditForm({ ...editForm, isNotable: e.target.checked })}
                        className="rounded"
                      />
                      Notable Moment
                    </label>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleSave(block.id)}
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
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-medium text-gray-500">#{block.id}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {getChannelName(block.channelId)}
                      </span>
                      <span className="text-xs text-gray-400">
                        {getSessionTitle(block.sessionId)}
                      </span>
                      {block.isNotable && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                          Notable
                        </span>
                      )}
                    </div>
                    {block.title && (
                      <div className="text-sm font-medium mb-1">{block.title}</div>
                    )}
                    <div className="text-sm whitespace-pre-wrap">{block.content}</div>

                    {(block.optionA || block.optionB) && (
                      <div className="mt-2">
                        <button
                          onClick={() => setExpandedOptions(expandedOptions === block.id ? null : block.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {expandedOptions === block.id ? 'Hide' : 'Show'} Options
                        </button>

                        {expandedOptions === block.id && (
                          <div className="mt-2 flex gap-4 text-xs">
                            {block.optionA && (
                              <div className="bg-blue-50 rounded p-2 flex-1">
                                <div className="font-medium text-blue-700">A: {block.optionA.label}</div>
                                {block.optionA.description && (
                                  <div className="text-blue-600">{block.optionA.description}</div>
                                )}
                              </div>
                            )}
                            {block.optionB && (
                              <div className="bg-purple-50 rounded p-2 flex-1">
                                <div className="font-medium text-purple-700">B: {block.optionB.label}</div>
                                {block.optionB.description && (
                                  <div className="text-purple-600">{block.optionB.description}</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {block.imageUrl && (
                      <div className="mt-2 text-xs text-gray-400">
                        Image: <span className="truncate max-w-xs inline-block align-bottom">{block.imageUrl}</span>
                      </div>
                    )}

                    <div className="text-xs text-gray-400 mt-1">
                      {formatDate(block.createdAt)}
                    </div>

                    {injectForId === block.id && (
                      <div className="mt-3 pt-3 border-t border-purple-200">
                        <div className="text-xs font-medium text-purple-700 mb-2">
                          Queue Next Block — replaces AI content for the next narrative turn or vote outcome
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">Choice *</label>
                            <div className="flex gap-4">
                              <label className="flex items-center gap-1.5 text-xs">
                                <input
                                  type="radio"
                                  name={`inject-choice-${block.id}`}
                                  checked={injectForm.choice === 'A'}
                                  onChange={() => setInjectForm({ ...injectForm, choice: 'A' })}
                                />
                                A — Narrative turn
                              </label>
                              <label className="flex items-center gap-1.5 text-xs">
                                <input
                                  type="radio"
                                  name={`inject-choice-${block.id}`}
                                  checked={injectForm.choice === 'B'}
                                  onChange={() => setInjectForm({ ...injectForm, choice: 'B' })}
                                />
                                B — Vote outcome
                              </label>
                            </div>
                          </div>

                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">Content *</label>
                            <textarea
                              value={injectForm.content}
                              onChange={(e) => setInjectForm({ ...injectForm, content: e.target.value })}
                              className="border border-gray-300 rounded px-2 py-1 w-full h-20 text-sm"
                              placeholder="The story text that replaces what the AI would generate..."
                            />
                          </div>

                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">Dialogue</label>
                            <textarea
                              value={injectForm.dialogue}
                              onChange={(e) => setInjectForm({ ...injectForm, dialogue: e.target.value })}
                              className="border border-gray-300 rounded px-2 py-1 w-full h-12 text-sm"
                              placeholder="Spoken dialogue (optional)..."
                            />
                          </div>

                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">Title</label>
                            <input
                              type="text"
                              value={injectForm.title}
                              onChange={(e) => setInjectForm({ ...injectForm, title: e.target.value })}
                              className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
                              placeholder="Optional title..."
                            />
                          </div>

                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">Image URL</label>
                            <input
                              type="text"
                              value={injectForm.imageUrl}
                              onChange={(e) => setInjectForm({ ...injectForm, imageUrl: e.target.value })}
                              className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
                              placeholder="https://..."
                            />
                          </div>

                          <div className="col-span-2 font-medium text-xs text-gray-500 mt-1">Options</div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Option A Label</label>
                            <input
                              type="text"
                              value={injectForm.optionALabel}
                              onChange={(e) => setInjectForm({ ...injectForm, optionALabel: e.target.value })}
                              className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
                              placeholder="e.g. 'Fight'"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Option A Description</label>
                            <input
                              type="text"
                              value={injectForm.optionADescription}
                              onChange={(e) => setInjectForm({ ...injectForm, optionADescription: e.target.value })}
                              className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
                              placeholder="Brief description..."
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Option B Label</label>
                            <input
                              type="text"
                              value={injectForm.optionBLabel}
                              onChange={(e) => setInjectForm({ ...injectForm, optionBLabel: e.target.value })}
                              className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
                              placeholder="e.g. 'Flee'"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Option B Description</label>
                            <input
                              type="text"
                              value={injectForm.optionBDescription}
                              onChange={(e) => setInjectForm({ ...injectForm, optionBDescription: e.target.value })}
                              className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
                              placeholder="Brief description..."
                            />
                          </div>
                        </div>

                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={handleInject}
                            disabled={injectStatus === 'saving'}
                            className="text-xs font-medium text-purple-700 hover:underline disabled:text-gray-400"
                          >
                            {injectStatus === 'saving'
                              ? 'Injecting...'
                              : injectStatus === 'done'
                                ? '✓ Injected!'
                                : 'Inject →'}
                          </button>
                          <button
                            onClick={handleInjectCancel}
                            className="text-xs text-gray-500 hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleToggleNotable(block)}
                      className={`text-xs hover:underline ${block.isNotable ? 'text-amber-600' : 'text-gray-400'}`}
                      title={block.isNotable ? 'Unmark as notable' : 'Mark as notable'}
                    >
                      {block.isNotable ? '★' : '☆'}
                    </button>
                    <button
                      onClick={() => handleInjectOpen(block)}
                      className="text-xs text-purple-600 hover:underline"
                      title="Queue this block's next continuation (bypasses AI)"
                    >
                      Queue Next
                    </button>
                    <button
                      onClick={() => handleEdit(block)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(block.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {blocks?.length === 0 && !loading && (
        <p className="text-gray-500 mt-4">No blocks found</p>
      )}
    </div>
  )
}
