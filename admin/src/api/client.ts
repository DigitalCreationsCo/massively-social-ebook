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
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = typeof errorJson?.message === 'string' ? errorJson.message : (errorText || `HTTP ${response.status}`);
    } catch {
      errorMessage = errorText || `HTTP ${response.status}`;
    }
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return undefined as T
  }

  // Guard against non-JSON responses (e.g. HTML from a missing route caught by a catch-all handler)
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(
      `Expected JSON response from ${endpoint} but got ${contentType}. ` +
      `Status: ${response.status}. Body: ${text.substring(0, 200)}`
    );
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
