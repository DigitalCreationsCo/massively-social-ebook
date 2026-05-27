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
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const result = await fetchFn()
      setData(result)
      setLastUpdated(new Date())
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error in usePolling');
      // Log for debugging — do not silently swallow
      console.error('[usePolling] Fetch failed:', error);
      setError(error);
    } finally {
      setLoading(false)
    }
  }, [fetchFn])

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, ...deps])

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }

    if (interval > 0) {
      // Use global setInterval (works in both browser and Node environments)
      intervalRef.current = setInterval(refresh, interval)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [interval, refresh])

  return { data, loading, error, lastUpdated, refresh }
}
