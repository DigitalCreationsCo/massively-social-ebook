import { useState, useCallback, useEffect } from 'react'
import { useAdminToken, getAuthHeader } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch } from '../../api/client';
import { Channel } from '@shared/schema'

// Chat message type with proper typing for JSON response
interface ChatMessageData {
  id: number
  channelId: string
  sessionId: number | null
  username: string
  text: string
  createdAt: string
}

/**
 * Safely parse a date string into a Date object.
 * Handles ISO strings, timestamps, and invalid inputs gracefully.
 */
function safeParseDate(dateValue: unknown): Date {
  if (!dateValue) return new Date(0)
  if (typeof dateValue === 'string') {
    const parsed = new Date(dateValue)
    return isNaN(parsed.getTime()) ? new Date(0) : parsed
  }
  if (typeof dateValue === 'number') {
    return new Date(dateValue)
  }
  if (dateValue instanceof Date) {
    return isNaN(dateValue.getTime()) ? new Date(0) : dateValue
  }
  return new Date(0)
}

/**
 * Format a date for display, returning a fallback for invalid dates.
 */
function formatTime(dateValue: unknown): string {
  const date = safeParseDate(dateValue)
  if (date.getTime() === 0) return '--:--:--'
  return date.toLocaleTimeString()
}

export default function ChatTab() {
  const { token } = useAdminToken()
  const [channelFilter, setChannelFilter] = useState<string>('')

  const fetchChannels = useCallback(async () => {
    return adminFetch<Channel[]>('/channels', token)
  }, [token])

  const { data: channels } = usePolling(fetchChannels, 30000, [token])

  useEffect(() => {
    if (channels && channels.length > 0 && !channelFilter) {
      setChannelFilter(channels[0].channelId)
    }
  }, [channels, channelFilter])

  const fetchChat = useCallback(async (): Promise<ChatMessageData[]> => {
    if (!channelFilter) return []
    
    const headers = getAuthHeader(token)
    const res = await fetch(`/api/chat?channelId=${channelFilter}`, {
      headers,
    })
    
    if (!res.ok) {
      throw new Error(`Failed to fetch chat: ${res.status} ${res.statusText}`)
    }
    
    const data = await res.json()
    
    // Ensure we always return an array and parse dates properly
    if (!Array.isArray(data)) {
      console.warn('Unexpected chat response format:', typeof data)
      return []
    }
    
    // Validate and normalize each message
    return data.map(msg => ({
      id: Number(msg.id) || 0,
      channelId: String(msg.channelId || ''),
      sessionId: msg.sessionId != null ? Number(msg.sessionId) : null,
      username: String(msg.username || 'Unknown'),
      text: String(msg.text || ''),
      createdAt: typeof msg.createdAt === 'string' ? msg.createdAt : 
                 msg.createdAt instanceof Date ? msg.createdAt.toISOString() :
                 String(msg.createdAt || new Date().toISOString()),
    }))
  }, [token, channelFilter])

  const { data: messages, loading, error, refresh } = usePolling(fetchChat, 5000, [token, channelFilter])

  const handleRefresh = useCallback(() => {
    refresh()
  }, [refresh])

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
            {channels?.map(ch => (
              <option key={ch.id} value={ch.channelId}>{ch.name}</option>
            ))}
          </select>
        </label>
        <button
          onClick={handleRefresh}
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh
        </button>
        {messages && (
          <span className="text-sm text-gray-500">
            {messages.length} messages
          </span>
        )}
      </div>

      {loading && <p className="text-gray-500">Loading...</p>}
      {error && <p className="text-red-500">Error: {error.message}</p>}

      <div className="border border-gray-200 rounded bg-white max-h-96 overflow-y-auto">
        {messages?.slice().reverse().map((msg) => (
          <div key={msg.id} className="border-b border-gray-100 p-2 hover:bg-gray-50">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{msg.username}</span>
              <span className="text-xs text-gray-400">
                { formatTime(msg.createdAt) }
              </span>
            </div>
            <div className="text-sm mt-0.5">{msg.text}</div>
          </div>
        ))}
      </div>

      {messages?.length === 0 && !loading && (
        <p className="text-gray-500 mt-4">No chat messages found</p>
      )}
    </div>
  )
}
