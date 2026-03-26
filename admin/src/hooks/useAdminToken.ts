import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'controlroom_token'

export function useAdminToken() {
  const [token, setTokenState] = useState('')
  const [isValid, setIsValid] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const envToken = import.meta.env.VITE_ADMIN_TOKEN
    
    if (stored) {
      setTokenState(stored)
      setIsValid(true)
    } else if (envToken) {
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

export function getAuthHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}
