import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useAdminToken } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch } from '../../api/client';
import { Channel } from '@shared/schema'

// ─── Types ──────────────────────────────────────────────────────────────────

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

interface CreateBlockFormState {
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateValue: unknown): string {
  if (!dateValue) return '--'
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue as string)
  if (isNaN(date.getTime())) return '--'
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function buildBlockPayload(
  content: string,
  title: string,
  imageUrl: string,
  isNotable: boolean,
  optionALabel: string,
  optionADescription: string,
  optionBLabel: string,
  optionBDescription: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    content,
    title: title || null,
    imageUrl: imageUrl || null,
    isNotable,
  }

  if (optionALabel || optionADescription) {
    payload.optionA = {
      label: optionALabel || null,
      description: optionADescription || null,
    }
  } else {
    payload.optionA = null
  }

  if (optionBLabel || optionBDescription) {
    payload.optionB = {
      label: optionBLabel || null,
      description: optionBDescription || null,
    }
  } else {
    payload.optionB = null
  }

  return payload
}

// ═══════════════════════════════════════════════════════════════════════════
//  FilterBar — fully controlled, memoized presentational component
// ═══════════════════════════════════════════════════════════════════════════

interface FilterBarProps {
  channelFilter: string
  sessionFilter: string
  channels: Channel[] | null
  activeSessions: Session[] | null
  blocksCount: number | undefined
  onChannelFilterChange: (channelId: string) => void
  onSessionFilterChange: (sessionId: string) => void
  onRefresh: () => void
  onCreateNew: () => void
}

function FilterBar({
  channelFilter,
  sessionFilter,
  channels,
  activeSessions,
  blocksCount,
  onChannelFilterChange,
  onSessionFilterChange,
  onRefresh,
  onCreateNew,
}: FilterBarProps) {
  const handleChannelFilter = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChannelFilterChange(e.target.value)
    },
    [onChannelFilterChange],
  )

  const handleSessionFilter = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onSessionFilterChange(e.target.value)
    },
    [onSessionFilterChange],
  )

  return (
    <div className="flex gap-4 mb-4 items-center flex-wrap">
      <label className="text-sm">
        Channel:
        <select
          value={channelFilter}
          onChange={handleChannelFilter}
          className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="">All Channels</option>
          {channels?.map(ch => (
            <option key={ch.id} value={ch.channelId}>
              {ch.name}
            </option>
          ))}
        </select>
      </label>

      {channelFilter && (
        <label className="text-sm">
          Session:
          <select
            value={sessionFilter}
            onChange={handleSessionFilter}
            className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">All Sessions</option>
            {activeSessions?.map(s => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
      )}

      <button onClick={onRefresh} className="text-sm text-blue-600 hover:underline">
        Refresh
      </button>

      <button onClick={onCreateNew} className="text-sm text-green-600 hover:underline">
        + New Block
      </button>

      {blocksCount !== undefined && (
        <span className="text-sm text-gray-500">
          {blocksCount} block{blocksCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  CreateBlockForm — ISOLATED form state. Keystrokes never touch parent.
// ═══════════════════════════════════════════════════════════════════════════

interface CreateBlockFormProps {
  channels: Channel[] | null
  activeSessions: Session[] | null
  onCreate: (form: CreateBlockFormState) => void
  onCancel: () => void
}

function CreateBlockForm({
  channels,
  activeSessions,
  onCreate,
  onCancel,
}: CreateBlockFormProps) {
  const [form, setForm] = useState<CreateBlockFormState>(() => ({
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
  }))

  // When channels first load, auto-select the first one
  useEffect(() => {
    if (channels && channels.length > 0 && !form.channelId) {
      setForm(prev => ({ ...prev, channelId: channels[0].channelId }))
    }
  }, [channels, form.channelId])

  const filteredSessions = useMemo(
    () => activeSessions?.filter(s => s.channelId === form.channelId) || [],
    [activeSessions, form.channelId],
  )

  const handleChannelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, channelId: e.target.value, sessionId: '' }))
  }, [])

  const handleSessionChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, sessionId: e.target.value }))
  }, [])

  const handleTextField = useCallback(
    (field: 'title' | 'content' | 'imageUrl' | 'optionALabel' | 'optionADescription' | 'optionBLabel' | 'optionBDescription') =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm(prev => ({ ...prev, [field]: e.target.value }))
      },
    [],
  )

  const handleCheckbox = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, isNotable: e.target.checked }))
  }, [])

  const handleSubmit = useCallback(() => {
    if (!form.channelId || !form.sessionId || !form.content) {
      alert('Please fill in required fields: Channel, Session, and Content')
      return
    }
    onCreate(form)
  }, [form, onCreate])

  return (
    <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
      <h3 className="text-sm font-medium mb-3">Create New Block</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Channel *</label>
          <select
            value={form.channelId}
            onChange={handleChannelChange}
            className="border border-gray-300 rounded px-2 py-1 w-full"
          >
            {channels?.map(ch => (
              <option key={ch.id} value={ch.channelId}>
                {ch.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Session *</label>
          <select
            value={form.sessionId}
            onChange={handleSessionChange}
            className="border border-gray-300 rounded px-2 py-1 w-full"
            disabled={!form.channelId}
          >
            <option value="">Select session...</option>
            {filteredSessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">Title</label>
          <input
            type="text"
            value={form.title}
            onChange={handleTextField('title')}
            className="border border-gray-300 rounded px-2 py-1 w-full"
            placeholder="Optional title..."
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">Content *</label>
          <textarea
            value={form.content}
            onChange={handleTextField('content')}
            className="border border-gray-300 rounded px-2 py-1 w-full h-24"
            placeholder="Story content..."
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">Image URL</label>
          <input
            type="text"
            value={form.imageUrl}
            onChange={handleTextField('imageUrl')}
            className="border border-gray-300 rounded px-2 py-1 w-full"
            placeholder="https://..."
          />
        </div>

        <div className="col-span-2 font-medium text-xs text-gray-500 mt-2">Choice A</div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Option A Label</label>
          <input
            type="text"
            value={form.optionALabel}
            onChange={handleTextField('optionALabel')}
            className="border border-gray-300 rounded px-2 py-1 w-full"
            placeholder="e.g., 'Take the left path'"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Option A Description</label>
          <input
            type="text"
            value={form.optionADescription}
            onChange={handleTextField('optionADescription')}
            className="border border-gray-300 rounded px-2 py-1 w-full"
            placeholder="Brief description..."
          />
        </div>

        <div className="col-span-2 font-medium text-xs text-gray-500 mt-2">Choice B</div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Option B Label</label>
          <input
            type="text"
            value={form.optionBLabel}
            onChange={handleTextField('optionBLabel')}
            className="border border-gray-300 rounded px-2 py-1 w-full"
            placeholder="e.g., 'Take the right path'"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Option B Description</label>
          <input
            type="text"
            value={form.optionBDescription}
            onChange={handleTextField('optionBDescription')}
            className="border border-gray-300 rounded px-2 py-1 w-full"
            placeholder="Brief description..."
          />
        </div>

        <div className="col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isNotable}
              onChange={handleCheckbox}
              className="rounded"
            />
            Mark as Notable Moment
          </label>
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={handleSubmit} className="text-sm text-green-600 hover:underline">
          Create
        </button>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  BlockCard — renders a single block. Owns edit/inject form state locally
//  so keystrokes during editing/injecting don't cascade to parent or siblings.
// ═══════════════════════════════════════════════════════════════════════════

interface InjectFormProps {
  block: Block
  onInject: (block: Block, payload: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}

function InjectForm({ block, onInject, onCancel }: InjectFormProps) {
  const [choice, setChoice] = useState<'A' | 'B'>('A')
  const [title, setTitle] = useState(block.title ?? '')
  const [content, setContent] = useState('')
  const [dialogue, setDialogue] = useState('')
  const [imageUrl, setImageUrl] = useState(block.imageUrl ?? '')
  const [optionALabel, setOptionALabel] = useState(block.optionA?.label ?? '')
  const [optionADescription, setOptionADescription] = useState(block.optionA?.description ?? '')
  const [optionBLabel, setOptionBLabel] = useState(block.optionB?.label ?? '')
  const [optionBDescription, setOptionBDescription] = useState(block.optionB?.description ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')

  const handleSubmit = useCallback(async () => {
    if (!content) {
      alert('Content is required to inject a pending block.')
      return
    }

    setStatus('saving')

    const payload: Record<string, unknown> = {
      choice,
      content,
      title: title || null,
      dialogue: dialogue || null,
      imageUrl: imageUrl || null,
    }

    if (optionALabel || optionADescription) {
      payload.optionA = {
        label: optionALabel || null,
        description: optionADescription || null,
      }
    }

    if (optionBLabel || optionBDescription) {
      payload.optionB = {
        label: optionBLabel || null,
        description: optionBDescription || null,
      }
    }

    try {
      await onInject(block, payload)
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }, [
    choice, content, title, dialogue, imageUrl,
    optionALabel, optionADescription, optionBLabel, optionBDescription,
    block, onInject,
  ])

  return (
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
                checked={choice === 'A'}
                onChange={() => setChoice('A')}
              />
              A — Narrative turn
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name={`inject-choice-${block.id}`}
                checked={choice === 'B'}
                onChange={() => setChoice('B')}
              />
              B — Vote outcome
            </label>
          </div>
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">Content *</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 w-full h-20 text-sm"
            placeholder="The story text that replaces what the AI would generate..."
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">Dialogue</label>
          <textarea
            value={dialogue}
            onChange={e => setDialogue(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 w-full h-12 text-sm"
            placeholder="Spoken dialogue (optional)..."
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
            placeholder="Optional title..."
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">Image URL</label>
          <input
            type="text"
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
            placeholder="https://..."
          />
        </div>

        <div className="col-span-2 font-medium text-xs text-gray-500 mt-1">Options</div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Option A Label</label>
          <input
            type="text"
            value={optionALabel}
            onChange={e => setOptionALabel(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
            placeholder="e.g. 'Fight'"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Option A Description</label>
          <input
            type="text"
            value={optionADescription}
            onChange={e => setOptionADescription(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
            placeholder="Brief description..."
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Option B Label</label>
          <input
            type="text"
            value={optionBLabel}
            onChange={e => setOptionBLabel(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
            placeholder="e.g. 'Flee'"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Option B Description</label>
          <input
            type="text"
            value={optionBDescription}
            onChange={e => setOptionBDescription(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
            placeholder="Brief description..."
          />
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={handleSubmit}
          disabled={status === 'saving'}
          className="text-xs font-medium text-purple-700 hover:underline disabled:text-gray-400"
        >
          {status === 'saving' ? 'Injecting...' : status === 'done' ? '\u2713 Injected!' : 'Inject \u2192'}
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  )
}

interface BlockCardProps {
  block: Block
  channelName: string
  sessionTitle: string
  isEditing: boolean
  isInjecting: boolean
  isExpanded: boolean
  onEdit: (block: Block) => void
  onCancelEdit: () => void
  onSave: (id: number, payload: Record<string, unknown>) => void
  onToggleNotable: (block: Block) => void
  onDelete: (id: number) => void
  onInjectOpen: (block: Block) => void
  onInjectCancel: () => void
  onInject: (block: Block, payload: Record<string, unknown>) => Promise<void>
  onToggleOptions: (blockId: number) => void
}

function BlockCard({
  block,
  channelName,
  sessionTitle,
  isEditing,
  isInjecting,
  isExpanded,
  onEdit,
  onCancelEdit,
  onSave,
  onToggleNotable,
  onDelete,
  onInjectOpen,
  onInjectCancel,
  onInject,
  onToggleOptions,
}: BlockCardProps) {
  // --- Local edit form state (isolated — keystrokes only affect this card) ---
  const [editForm, setEditForm] = useState(() => ({
    title: block.title || '',
    content: block.content,
    imageUrl: block.imageUrl || '',
    optionALabel: block.optionA?.label || '',
    optionADescription: block.optionA?.description || '',
    optionBLabel: block.optionB?.label || '',
    optionBDescription: block.optionB?.description || '',
    isNotable: block.isNotable,
  }))

  // Reset local edit form when entering edit mode for THIS block
  // (handles the case where block data might have updated since mount)
  const prevEditingRef = useRef(isEditing)
  useEffect(() => {
    if (isEditing && !prevEditingRef.current) {
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
    prevEditingRef.current = isEditing
  }, [isEditing, block])

  const handleEditField = useCallback(
    (field: 'title' | 'content' | 'imageUrl' | 'optionALabel' | 'optionADescription' | 'optionBLabel' | 'optionBDescription') =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setEditForm(prev => ({ ...prev, [field]: e.target.value }))
      },
    [],
  )

  const handleEditCheckbox = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditForm(prev => ({ ...prev, isNotable: e.target.checked }))
  }, [])

  const handleSave = useCallback(() => {
    const payload = buildBlockPayload(
      editForm.content,
      editForm.title,
      editForm.imageUrl,
      editForm.isNotable,
      editForm.optionALabel,
      editForm.optionADescription,
      editForm.optionBLabel,
      editForm.optionBDescription,
    )
    onSave(block.id, payload)
  }, [editForm, block.id, onSave])

  // Stable callbacks for parent actions
  const handleEditClick = useCallback(() => onEdit(block), [onEdit, block])
  const handleToggleNotable = useCallback(() => onToggleNotable(block), [onToggleNotable, block])
  const handleDeleteClick = useCallback(() => onDelete(block.id), [onDelete, block.id])
  const handleInjectOpen = useCallback(() => onInjectOpen(block), [onInjectOpen, block])
  const handleToggleOptions = useCallback(() => onToggleOptions(block.id), [onToggleOptions, block.id])

  return (
    <div className="border border-gray-200 rounded p-3 bg-white">
      {isEditing ? (
        /* ──── Edit Mode ──── */
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Title</label>
              <input
                type="text"
                value={editForm.title}
                onChange={handleEditField('title')}
                className="border border-gray-300 rounded px-2 py-1 w-full"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Content *</label>
              <textarea
                value={editForm.content}
                onChange={handleEditField('content')}
                className="border border-gray-300 rounded px-2 py-1 w-full h-20"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Image URL</label>
              <input
                type="text"
                value={editForm.imageUrl}
                onChange={handleEditField('imageUrl')}
                className="border border-gray-300 rounded px-2 py-1 w-full"
              />
            </div>

            <div className="col-span-2 font-medium text-xs text-gray-500">Option A</div>
            <div>
              <input
                type="text"
                value={editForm.optionALabel}
                onChange={handleEditField('optionALabel')}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="Label"
              />
            </div>
            <div>
              <input
                type="text"
                value={editForm.optionADescription}
                onChange={handleEditField('optionADescription')}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="Description"
              />
            </div>

            <div className="col-span-2 font-medium text-xs text-gray-500">Option B</div>
            <div>
              <input
                type="text"
                value={editForm.optionBLabel}
                onChange={handleEditField('optionBLabel')}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="Label"
              />
            </div>
            <div>
              <input
                type="text"
                value={editForm.optionBDescription}
                onChange={handleEditField('optionBDescription')}
                className="border border-gray-300 rounded px-2 py-1 w-full"
                placeholder="Description"
              />
            </div>

            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editForm.isNotable}
                  onChange={handleEditCheckbox}
                  className="rounded"
                />
                Notable Moment
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={handleSave} className="text-xs text-green-600 hover:underline">
              Save
            </button>
            <button onClick={onCancelEdit} className="text-xs text-gray-500 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* ──── View Mode ──── */
        <div>
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-medium text-gray-500">#{block.id}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                  {channelName}
                </span>
                <span className="text-xs text-gray-400">{sessionTitle}</span>
                {block.isNotable && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                    Notable
                  </span>
                )}
              </div>
              {block.title && <div className="text-sm font-medium mb-1">{block.title}</div>}
              <div className="text-sm whitespace-pre-wrap">{block.content}</div>

              {(block.optionA || block.optionB) && (
                <div className="mt-2">
                  <button
                    onClick={handleToggleOptions}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {isExpanded ? 'Hide' : 'Show'} Options
                  </button>

                  {isExpanded && (
                    <div className="mt-2 flex gap-4 text-xs">
                      {block.optionA && (
                        <div className="bg-blue-50 rounded p-2 flex-1">
                          <div className="font-medium text-blue-700">
                            A: {block.optionA.label}
                          </div>
                          {block.optionA.description && (
                            <div className="text-blue-600">{block.optionA.description}</div>
                          )}
                        </div>
                      )}
                      {block.optionB && (
                        <div className="bg-purple-50 rounded p-2 flex-1">
                          <div className="font-medium text-purple-700">
                            B: {block.optionB.label}
                          </div>
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
                  Image:{' '}
                  <span className="truncate max-w-xs inline-block align-bottom">
                    {block.imageUrl}
                  </span>
                </div>
              )}

              <div className="text-xs text-gray-400 mt-1">{formatDate(block.createdAt)}</div>

              {/* Inject Form (only when active for this block) */}
              {isInjecting && (
                <InjectForm
                  block={block}
                  onInject={onInject}
                  onCancel={onInjectCancel}
                />
              )}
            </div>

            <div className="flex gap-2 ml-4">
              <button
                onClick={handleToggleNotable}
                className={`text-xs hover:underline ${block.isNotable ? 'text-amber-600' : 'text-gray-400'}`}
                title={block.isNotable ? 'Unmark as notable' : 'Mark as notable'}
              >
                {block.isNotable ? '\u2605' : '\u2606'}
              </button>
              <button
                onClick={handleInjectOpen}
                className="text-xs text-purple-600 hover:underline"
                title="Queue this block's next continuation (bypasses AI)"
              >
                Queue Next
              </button>
              <button onClick={handleEditClick} className="text-xs text-blue-600 hover:underline">
                Edit
              </button>
              <button onClick={handleDeleteClick} className="text-xs text-red-600 hover:underline">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  BlocksList — renders the list of blocks via BlockCard
// ═══════════════════════════════════════════════════════════════════════════

interface BlocksListProps {
  blocks: Block[]
  channelsMap: Map<string, string>
  sessionsMap: Map<number, string>
  editingId: number | null
  injectForId: number | null
  expandedOptions: number | null
  onEdit: (block: Block) => void
  onCancelEdit: () => void
  onSave: (id: number, payload: Record<string, unknown>) => void
  onToggleNotable: (block: Block) => void
  onDelete: (id: number) => void
  onInjectOpen: (block: Block) => void
  onInjectCancel: () => void
  onInject: (block: Block, payload: Record<string, unknown>) => Promise<void>
  onToggleOptions: (blockId: number) => void
}

function BlocksList({
  blocks,
  channelsMap,
  sessionsMap,
  editingId,
  injectForId,
  expandedOptions,
  onEdit,
  onCancelEdit,
  onSave,
  onToggleNotable,
  onDelete,
  onInjectOpen,
  onInjectCancel,
  onInject,
  onToggleOptions,
}: BlocksListProps) {
  return (
    <div className="space-y-2">
      {blocks.map(block => (
        <BlockCard
          key={block.id}
          block={block}
          channelName={channelsMap.get(block.channelId) ?? block.channelId}
          sessionTitle={sessionsMap.get(block.sessionId) ?? `Session #${block.sessionId}`}
          isEditing={editingId === block.id}
          isInjecting={injectForId === block.id}
          isExpanded={expandedOptions === block.id}
          onEdit={onEdit}
          onCancelEdit={onCancelEdit}
          onSave={onSave}
          onToggleNotable={onToggleNotable}
          onDelete={onDelete}
          onInjectOpen={onInjectOpen}
          onInjectCancel={onInjectCancel}
          onInject={onInject}
          onToggleOptions={onToggleOptions}
        />
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  BlocksTab (main — exported)
// ═══════════════════════════════════════════════════════════════════════════

export default function BlocksTab() {
  const { token } = useAdminToken()

  // ── Filter state (changes are infrequent user actions) ──
  const [channelFilter, setChannelFilter] = useState<string>('')
  const [sessionFilter, setSessionFilter] = useState<string>('')

  // ── UI state toggles (infrequent, not per-keystroke) ──
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [injectForId, setInjectForId] = useState<number | null>(null)
  const [expandedOptions, setExpandedOptions] = useState<number | null>(null)

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchChannels = useCallback(async () => {
    return adminFetch<Channel[]>('/channels', token)
  }, [token])

  const { data: channels } = usePolling(fetchChannels, 30000, [token])

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

  const { data: blocks, loading, error, refresh } = usePolling(fetchBlocks, 15000, [
    token,
    channelFilter,
    sessionFilter,
  ])

  // ── O(1) lookup maps (avoid O(n) array find per block per render) ──

  const channelsMap = useMemo(() => {
    const map = new Map<string, string>()
    channels?.forEach(c => map.set(c.channelId, c.name))
    return map
  }, [channels])

  const sessionsMap = useMemo(() => {
    const map = new Map<number, string>()
    activeSessions?.forEach(s => map.set(s.id, s.title))
    return map
  }, [activeSessions])

  // ── Filter/UI handlers ────────────────────────────────────────────────────

  const handleChannelFilterChange = useCallback((channelId: string) => {
    setChannelFilter(channelId)
    setSessionFilter('')
  }, [])

  const handleSessionFilterChange = useCallback((sessionId: string) => {
    setSessionFilter(sessionId)
  }, [])

  const handleCreateNew = useCallback(() => {
    setShowCreateForm(true)
  }, [])

  const handleCancelCreate = useCallback(() => {
    setShowCreateForm(false)
  }, [])

  const handleEdit = useCallback((block: Block) => {
    setEditingId(block.id)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
  }, [])

  const handleInjectOpen = useCallback((block: Block) => {
    setInjectForId(block.id)
  }, [])

  const handleInjectCancel = useCallback(() => {
    setInjectForId(null)
  }, [])

  const handleToggleOptions = useCallback((blockId: number) => {
    setExpandedOptions(prev => (prev === blockId ? null : blockId))
  }, [])

  // ── API mutation handlers ─────────────────────────────────────────────────

  const handleCreateBlock = useCallback(
    async (form: CreateBlockFormState) => {
      const payload: Record<string, unknown> = {
        channelId: form.channelId,
        sessionId: parseInt(form.sessionId),
        content: form.content,
        title: form.title || null,
        imageUrl: form.imageUrl || null,
        isNotable: form.isNotable,
      }

      if (form.optionALabel || form.optionADescription) {
        payload.optionA = {
          label: form.optionALabel || null,
          description: form.optionADescription || null,
        }
      }

      if (form.optionBLabel || form.optionBDescription) {
        payload.optionB = {
          label: form.optionBLabel || null,
          description: form.optionBDescription || null,
        }
      }

      try {
        await adminFetch('/blocks', token, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        setShowCreateForm(false)
        refresh()
      } catch (err) {
        alert(`Failed to create block: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    },
    [token, refresh],
  )

  const handleSaveBlock = useCallback(
    async (id: number, payload: Record<string, unknown>) => {
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
    },
    [token, refresh],
  )

  const handleToggleNotable = useCallback(
    async (block: Block) => {
      try {
        await adminFetch(`/blocks/${block.id}`, token, {
          method: 'PATCH',
          body: JSON.stringify({ isNotable: !block.isNotable }),
        })
        refresh()
      } catch (err) {
        alert(`Failed to toggle notable: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    },
    [token, refresh],
  )

  const handleDeleteBlock = useCallback(
    async (id: number) => {
      if (!confirm('Delete this block? This cannot be undone.')) return
      try {
        await adminFetch(`/blocks/${id}`, token, { method: 'DELETE' })
        refresh()
      } catch (err) {
        alert(`Failed to delete block: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    },
    [token, refresh],
  )

  const handleInjectBlock = useCallback(
    async (block: Block, payload: Record<string, unknown>) => {
      payload.forBlockId = block.id
      payload.channelId = block.channelId

      try {
        await adminFetch('/pending-blocks', token, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        setInjectForId(null)
        refresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        alert(`Failed to inject pending block: ${message}`)
        throw err
      }
    },
    [token, refresh],
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4">
      <FilterBar
        channelFilter={channelFilter}
        sessionFilter={sessionFilter}
        channels={channels}
        activeSessions={activeSessions}
        blocksCount={blocks?.length}
        onChannelFilterChange={handleChannelFilterChange}
        onSessionFilterChange={handleSessionFilterChange}
        onRefresh={refresh}
        onCreateNew={handleCreateNew}
      />

      {showCreateForm && (
        <CreateBlockForm
          channels={channels}
          activeSessions={activeSessions}
          onCreate={handleCreateBlock}
          onCancel={handleCancelCreate}
        />
      )}

      {loading && <p className="text-gray-500">Loading...</p>}
      {error && <p className="text-red-500">Error: {error.message}</p>}

      <BlocksList
        blocks={blocks ?? []}
        channelsMap={channelsMap}
        sessionsMap={sessionsMap}
        editingId={editingId}
        injectForId={injectForId}
        expandedOptions={expandedOptions}
        onEdit={handleEdit}
        onCancelEdit={handleCancelEdit}
        onSave={handleSaveBlock}
        onToggleNotable={handleToggleNotable}
        onDelete={handleDeleteBlock}
        onInjectOpen={handleInjectOpen}
        onInjectCancel={handleInjectCancel}
        onInject={handleInjectBlock}
        onToggleOptions={handleToggleOptions}
      />

      {blocks?.length === 0 && !loading && (
        <p className="text-gray-500 mt-4">No blocks found</p>
      )}
    </div>
  )
}
