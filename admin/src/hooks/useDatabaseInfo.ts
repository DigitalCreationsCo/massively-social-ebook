import { useState, useEffect } from 'react'
import { getAdminInfo, type AdminInfo } from '../api/client'
import { useAdminToken } from './useAdminToken'

export function useDatabaseInfo() {
  const { token } = useAdminToken()
  const [info, setInfo] = useState<AdminInfo | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!token) return

    getAdminInfo(token)
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
  }, [token])

  return { info, error }
}
