import { useState, useCallback } from 'react'
import { useAdminToken } from '../../hooks/useAdminToken'
import { usePolling } from '../../hooks/usePolling'
import { adminFetch, type UsersResponse } from '../../api/client'

export default function UsersTab() {
  const { token } = useAdminToken()
  const [page, setPage] = useState(1)

  const fetchUsers = useCallback(async () => {
    return adminFetch<UsersResponse>(`/users?page=${page}&limit=50`, token)
  }, [token, page])

  const { data, loading, error, refresh } = usePolling(fetchUsers, 10000, [token, page])

  const handleBan = async (id: number, currentlyBanned: boolean) => {
    const action = currentlyBanned ? 'unban' : 'ban'
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} this user?`)) return
    await adminFetch(`/users/${id}/ban`, token, {
      method: 'PATCH',
      body: JSON.stringify({ banned: !currentlyBanned }),
    })
    refresh()
  }

  return (
    <div className="p-4">
      <div className="flex gap-4 mb-4 items-center">
        <button
          onClick={refresh}
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh
        </button>
        {data && (
          <span className="text-sm text-gray-500">
            Total: {data.total} users
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
              <th className="text-left py-2 px-2">Email</th>
              <th className="text-left py-2 px-2">Push Token</th>
              <th className="text-left py-2 px-2">Status</th>
              <th className="text-left py-2 px-2">Created</th>
              <th className="text-left py-2 px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((user) => (
              <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-2">{user.id}</td>
                <td className="py-2 px-2">{user.email || '-'}</td>
                <td className="py-2 px-2 text-xs font-mono truncate max-w-32">
                  {user.pushToken ? `${user.pushToken.slice(0, 20)}...` : '-'}
                </td>
                <td className="py-2 px-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${user.isBanned ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                    {user.isBanned ? 'Banned' : 'Active'}
                  </span>
                </td>
                <td className="py-2 px-2 text-xs">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="py-2 px-2">
                  <button
                    onClick={() => handleBan(user.id, user.isBanned)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    {user.isBanned ? 'Unban' : 'Ban'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.total > 50 && (
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-sm text-blue-600 hover:underline disabled:text-gray-400"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {page}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page * 50 >= data.total}
            className="text-sm text-blue-600 hover:underline disabled:text-gray-400"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
