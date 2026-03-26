import { useState } from 'react'
import { useAdminToken, getAuthHeader } from '../../hooks/useAdminToken'

export default function DebugTab() {
  const { token } = useAdminToken()
  const [debugChannel, setDebugChannel] = useState('scifi')
  const [result, setResult] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const debugAction = async (action: string) => {
    setLoading(true)
    setResult('')
    try {
      const headers = getAuthHeader(token)
      const res = await fetch(`/api/debug/sessions/${action}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: debugChannel }),
      })
      const data = await res.json()
      setResult(JSON.stringify(data, null, 2))
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
    setLoading(false)
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Debug Tools</h2>
      
      <div className="mb-4">
        <label className="text-sm">
          Channel:
          <select
            value={debugChannel}
            onChange={(e) => setDebugChannel(e.target.value)}
            className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="scifi">Sci-Fi</option>
            <option value="mystery">Mystery</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => debugAction('start')}
          disabled={loading}
          className="px-3 py-1.5 bg-green-500 text-white rounded text-sm hover:bg-green-600 disabled:opacity-50"
        >
          Start Session
        </button>
        <button
          onClick={() => debugAction('skip')}
          disabled={loading}
          className="px-3 py-1.5 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
        >
          Skip Phase
        </button>
        <button
          onClick={() => debugAction('tally')}
          disabled={loading}
          className="px-3 py-1.5 bg-purple-500 text-white rounded text-sm hover:bg-purple-600 disabled:opacity-50"
        >
          Force Tally
        </button>
        <button
          onClick={() => debugAction('narrative')}
          disabled={loading}
          className="px-3 py-1.5 bg-yellow-500 text-white rounded text-sm hover:bg-yellow-600 disabled:opacity-50"
        >
          Force Narrative
        </button>
        <button
          onClick={() => debugAction('resolve')}
          disabled={loading}
          className="px-3 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 disabled:opacity-50"
        >
          Force Resolve
        </button>
      </div>

      {result && (
        <pre className="bg-gray-100 p-3 rounded text-xs overflow-x-auto">
          {result}
        </pre>
      )}

      <div className="mt-6 text-xs text-gray-500">
        <p>Note: These debug tools are only available in development mode.</p>
      </div>
    </div>
  )
}
