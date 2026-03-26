import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'controlroom_token'

export function useAdminToken() {
  const [token, setTokenState] = useState('')
  const [isValid, setIsValid] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const envToken = import.meta.env.VITE_ADMIN_TOKEN
    
    if (stored && stored.length > 0) {
      setTokenState(stored)
      setIsValid(true)
    } else if (envToken && envToken.length > 0) {
      setTokenState(envToken)
      setIsValid(true)
    }
  }, [])

  const setToken = useCallback((newToken: string) => {
    setTokenState(newToken)
    localStorage.setItem(STORAGE_KEY, newToken)
    setIsValid(newToken.length > 0)
  }, [])

  return { token, setToken, isValid }
}

export function getAuthHeader(token: string | undefined | null): { Authorization: string } {
  if (!token || token.length === 0) {
    throw new Error('Admin token is not set. Cannot make authenticated request.')
  }
  return { Authorization: `Bearer ${token}` }
}
