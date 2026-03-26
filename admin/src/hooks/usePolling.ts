import { useState, useEffect, useCallback, useRef } from 'react'

export function usePolling<T>(
  fetchFn: () => Promise<T>,
  interval: number,
  deps: React.DependencyList = []
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const intervalRef = useRef<number>()

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const result = await fetchFn()
      setData(result)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [fetchFn])

  useEffect(() => {
    refresh()
  }, [refresh, ...deps])

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }

    if (interval > 0) {
      intervalRef.current = window.setInterval(refresh, interval)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [interval, refresh])

  return { data, loading, error, lastUpdated, refresh }
}
