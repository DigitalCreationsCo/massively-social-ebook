import { User } from "@shared/schema";

const API_BASE = '/admin/api'

export async function adminFetch<T>(
  endpoint: string,
  token: string | undefined,
  options: RequestInit = {}
): Promise<T> {
  if (!token || token.length === 0) {
    throw new Error('Admin token is not set. Cannot make authenticated request.')
  }
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message || `HTTP ${response.status}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}

export interface UsersResponse {
  users: User[]
  total: number
}

export interface AdminInfo {
  database: {
    name: string
    host: string
    connected: boolean
  }
  version: string
}

export async function getAdminInfo(token: string | undefined): Promise<AdminInfo> {
  return adminFetch<AdminInfo>('/info', token)
}
