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

export interface Session {
  id: number
  channelId: string
  scheduleId: number | null
  title: string
  description: string | null
  scheduledStart: string
  scheduledEnd: string
  status: 'scheduled' | 'active' | 'completed' | 'cancelled'
  notifyCount: number
  createdAt: string
}

export interface Schedule {
  id: number
  channelId: string
  scheduledDays: string[] | null
  scheduledTime: string | null
  intervalEnabled: boolean
  timezone: string
  nextRunAt: string | null
  createdAt: string
}

export interface Channel {
  id: number
  channelId: string
  name: string
  description: string | null
  createdAt: string
}

export interface Lore {
  id: number
  channelId: string
  content: string
  isActive: boolean
  createdAt: string
}

export interface User {
  id: number
  email: string | null
  pushToken: string | null
  isBanned: boolean
  createdAt: string
}

export interface UsersResponse {
  users: User[]
  total: number
}

export interface ChatMessage {
  id: number
  channelId: string
  username: string
  text: string
  sessionId: number | null
  createdAt: string
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
