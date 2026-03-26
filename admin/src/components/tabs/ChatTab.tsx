import { useState, useCallback } from 'react'
import { useAdminToken } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch, type ChatMessage } from '../../api/client'

export default function ChatTab() {
  const { token } = useAdminToken()
  const [channelFilter, setChannelFilter] = useState<string>('scifi')

  const fetchChat = useCallback(async () => {
    return adminFetch<ChatMessage[]>(`/chat?channelId=${channelFilter}`, token)
  }, [token, channelFilter])

  const { data: messages, loading, error, refresh } = usePolling(fetchChat, 5000, [token, channelFilter])

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
                {new Date(msg.createdAt).toLocaleTimeString()}
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
