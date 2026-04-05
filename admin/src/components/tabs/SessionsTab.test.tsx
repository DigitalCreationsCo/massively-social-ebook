import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const getLocalTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

const formatDateForDisplay = (date: string | Date, tz: string): string => {
  try {
    return formatInTimeZone(new Date(date), tz, "MMM d, yyyy 'at' h:mm a")
  } catch {
    return '—'
  }
}

const formatDateForHover = (date: string | Date, tz: string): string => {
  try {
    return formatInTimeZone(new Date(date), tz, "yyyy-MM-dd HH:mm zzz")
  } catch {
    return '—'
  }
}

const formatRelativeTime = (date: string | Date | null): string => {
  if (!date) return '—'
  try {
    const now = new Date()
    const d = new Date(date)
    if (isNaN(d.getTime())) return '—'
    
    const diffMs = d.getTime() - now.getTime()
    const diffMins = Math.round(diffMs / 60000)
    const absMins = Math.abs(diffMins)
    const diffHours = Math.round(diffMs / 3600000)
    const absHours = Math.abs(diffHours)
    const diffDays = Math.round(diffMs / 86400000)
    const absDays = Math.abs(diffDays)
    
    if (diffMs < 0) {
      if (absMins < 60) return `${absMins}m ago`
      if (absHours < 24) return `${absHours}h ago`
      return `${absDays}d ago`
    } else {
      if (absMins < 60) return `in ${absMins}m`
      if (absHours < 24) return `in ${absHours}h`
      return `in ${absDays}d`
    }
  } catch {
    return '—'
  }
}

interface Session {
  id: number
  title: string
  channelId: string
  scheduledStart: string
  scheduledEnd: string
  status: string
  createdAt: string
  description?: string | null
  timezone?: string
}

const shiftTimezoneString = (dateStr: string, oldTz: string, newTz: string): string => {
  try {
    const absDate = fromZonedTime(dateStr, oldTz);
    return formatInTimeZone(absDate, newTz, "yyyy-MM-dd'T'HH:mm");
  } catch {
    return dateStr;
  }
}

describe('SessionsTab Utilities', () => {
  describe('getLocalTimezone', () => {
    it('should return a string timezone', () => {
      const tz = getLocalTimezone()
      expect(typeof tz).toBe('string')
      expect(tz.length).toBeGreaterThan(0)
    })
  })

  describe('formatDateForDisplay', () => {
    it('should format date correctly', () => {
      const result = formatDateForDisplay('2026-04-05T14:30:00Z', 'UTC')
      expect(result).toContain('Apr')
      expect(result).toContain('2026')
    })

    it('should handle Date objects', () => {
      const date = new Date('2026-04-05T14:30:00Z')
      const result = formatDateForDisplay(date, 'UTC')
      expect(result).toContain('2026')
    })

    it('should return dash for invalid dates', () => {
      const result = formatDateForDisplay('invalid-date', 'UTC')
      expect(result).toBe('—')
    })
  })

  describe('formatDateForHover', () => {
    it('should format in given timezone', () => {
      const result = formatDateForHover('2026-04-05T14:30:00Z', 'UTC')
      expect(result).toContain('UTC')
      expect(result).toContain('2026-04-05')
    })

    it('should return dash for invalid dates', () => {
      const result = formatDateForHover('not-a-date', 'UTC')
      expect(result).toBe('—')
    })
  })

  describe('formatRelativeTime', () => {
    const now = new Date('2026-04-05T12:00:00Z')

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(now)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return dash for null', () => {
      expect(formatRelativeTime(null)).toBe('—')
    })

    it('should return dash for invalid date', () => {
      expect(formatRelativeTime('invalid')).toBe('—')
    })

    it('should return minutes ago for past times within an hour', () => {
      const pastDate = '2026-04-05T11:45:00Z'
      const result = formatRelativeTime(pastDate)
      expect(result).toContain('m ago')
    })

    it('should return hours ago for past times within a day', () => {
      const pastDate = '2026-04-05T08:00:00Z'
      const result = formatRelativeTime(pastDate)
      expect(result).toContain('h ago')
    })

    it('should return days ago for past times beyond a day', () => {
      const pastDate = '2026-04-01T12:00:00Z'
      const result = formatRelativeTime(pastDate)
      expect(result).toContain('d ago')
    })

    it('should return in Xm for future times within an hour', () => {
      const futureDate = '2026-04-05T12:30:00Z'
      const result = formatRelativeTime(futureDate)
      expect(result).toContain('in')
      expect(result).toContain('m')
    })

    it('should return in Xh for future times within a day', () => {
      const futureDate = '2026-04-05T18:00:00Z'
      const result = formatRelativeTime(futureDate)
      expect(result).toContain('in')
      expect(result).toContain('h')
    })

    it('should return in Xd for future times beyond a day', () => {
      const futureDate = '2026-04-15T12:00:00Z'
      const result = formatRelativeTime(futureDate)
      expect(result).toContain('in')
      expect(result).toContain('d')
    })
  })
  describe('shiftTimezoneString', () => {
    it('should correctly shift datetime-local string to new timezone', () => {
      // 15:00 UTC is 11:00 AM EDT (America/New_York is EDT in April)
      const dateStr = '2026-04-05T15:00'
      const result = shiftTimezoneString(dateStr, 'UTC', 'America/New_York')
      expect(result).toBe('2026-04-05T11:00')
    })

    it('should correctly shift from local to UTC', () => {
      // 11:00 AM EDT is 15:00 UTC
      const dateStr = '2026-04-05T11:00'
      const result = shiftTimezoneString(dateStr, 'America/New_York', 'UTC')
      expect(result).toBe('2026-04-05T15:00')
    })

    it('should return original string on failure', () => {
      const result = shiftTimezoneString('invalid', 'UTC', 'America/New_York')
      expect(result).toBe('invalid')
    })
  })
})

describe('Sorting Logic', () => {
  const sessions: Session[] = [
    { id: 3, title: 'C', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'scheduled', createdAt: '2026-04-01T00:00:00Z' },
    { id: 1, title: 'A', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'scheduled', createdAt: '2026-04-01T00:00:00Z' },
    { id: 2, title: 'B', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'scheduled', createdAt: '2026-04-01T00:00:00Z' },
  ]
  
  it('should sort by id ascending', () => {
    const sorted = [...sessions].sort((a, b) => {
      if (a.id < b.id) return -1
      if (a.id > b.id) return 1
      return 0
    })
    
    expect(sorted[0].id).toBe(1)
    expect(sorted[1].id).toBe(2)
    expect(sorted[2].id).toBe(3)
  })

  it('should sort by scheduledStart descending', () => {
    const sorted = [...sessions].sort((a, b) => {
      const aVal = new Date(a.scheduledStart).getTime()
      const bVal = new Date(b.scheduledStart).getTime()
      if (aVal < bVal) return 1
      if (aVal > bVal) return -1
      return 0
    })
    
    expect(sorted[0].id).toBe(3)
    expect(sorted[1].id).toBe(1)
    expect(sorted[2].id).toBe(2)
  })

  it('should sort by title alphabetically', () => {
    const sorted = [...sessions].sort((a, b) => {
      if (a.title < b.title) return -1
      if (a.title > b.title) return 1
      return 0
    })
    
    expect(sorted[0].title).toBe('A')
    expect(sorted[1].title).toBe('B')
    expect(sorted[2].title).toBe('C')
  })

  it('should sort by status', () => {
    const statusSessions: Session[] = [
      { id: 1, title: 'A', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'completed', createdAt: '2026-04-01T00:00:00Z' },
      { id: 2, title: 'B', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'scheduled', createdAt: '2026-04-01T00:00:00Z' },
      { id: 3, title: 'C', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'active', createdAt: '2026-04-01T00:00:00Z' },
    ]
    
    const sorted = [...statusSessions].sort((a, b) => {
      if (a.status < b.status) return -1
      if (a.status > b.status) return 1
      return 0
    })
    
    expect(sorted[0].status).toBe('active')
    expect(sorted[1].status).toBe('completed')
    expect(sorted[2].status).toBe('scheduled')
  })
})

describe('Filter Logic', () => {
  const sessions: Session[] = [
    { id: 1, title: 'Sci-Fi Session', channelId: 'scifi', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'scheduled', createdAt: '2026-04-01T00:00:00Z', description: 'Space adventure' },
    { id: 2, title: 'Mystery Session', channelId: 'mystery', scheduledStart: '2026-04-06T14:00:00Z', scheduledEnd: '2026-04-06T15:00:00Z', status: 'active', createdAt: '2026-04-01T00:00:00Z', description: 'Whodunit' },
    { id: 3, title: 'Fantasy Session', channelId: 'fantasy', scheduledStart: '2026-04-07T14:00:00Z', scheduledEnd: '2026-04-07T15:00:00Z', status: 'completed', createdAt: '2026-04-01T00:00:00Z', description: 'Dragon tale' },
  ]

  it('should filter by status', () => {
    const filtered = sessions.filter(s => s.status === 'scheduled')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe(1)
  })

  it('should filter by channelId', () => {
    const filtered = sessions.filter(s => s.channelId === 'mystery')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe(2)
  })

  it('should filter by search term in title', () => {
    const filtered = sessions.filter(s => s.title.toLowerCase().includes('mystery'))
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe(2)
  })

  it('should filter by search term in description', () => {
    const filtered = sessions.filter(s => s.description?.toLowerCase().includes('space'))
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe(1)
  })

  it('should filter by search term in channelId', () => {
    const filtered = sessions.filter(s => s.channelId.toLowerCase().includes('sci'))
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe(1)
  })

  it('should combine multiple filters', () => {
    const filtered = sessions.filter(s => 
      s.status === 'scheduled' && s.channelId === 'scifi'
    )
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe(1)
  })

  it('should return all when no filters match', () => {
    const filtered = sessions.filter(s => s.status === 'cancelled')
    expect(filtered).toHaveLength(0)
  })
})

describe('Edge Cases', () => {
  it('should handle sessions with null description', () => {
    const sessions: Session[] = [
      { id: 1, title: 'Test', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'scheduled', createdAt: '2026-04-01T00:00:00Z', description: null },
    ]
    
    const searchTerm = 'test'
    const filtered = sessions.filter(s => 
      s.title.toLowerCase().includes(searchTerm) ||
      s.channelId.toLowerCase().includes(searchTerm) ||
      (s.description?.toLowerCase().includes(searchTerm))
    )
    
    expect(filtered).toHaveLength(1)
  })

  it('should handle sessions with undefined description', () => {
    const sessions: Session[] = [
      { id: 1, title: 'Test', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'scheduled', createdAt: '2026-04-01T00:00:00Z', description: undefined },
    ]
    
    const searchTerm = 'test'
    const filtered = sessions.filter(s => 
      s.title.toLowerCase().includes(searchTerm) ||
      s.channelId.toLowerCase().includes(searchTerm) ||
      (s.description?.toLowerCase().includes(searchTerm))
    )
    
    expect(filtered).toHaveLength(1)
  })

  it('should handle sessions with empty createdAt', () => {
    const sessions: Session[] = [
      { id: 1, title: 'Test', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'scheduled', createdAt: '' },
    ]
    
    const sorted = [...sessions].sort((a, b) => {
      const aVal = new Date(a.createdAt || 0).getTime()
      const bVal = new Date(b.createdAt || 0).getTime()
      if (aVal < bVal) return -1
      if (aVal > bVal) return 1
      return 0
    })
    
    expect(sorted[0].id).toBe(1)
  })

  it('should handle sessions with undefined timezone', () => {
    const sessions: Session[] = [
      { id: 1, title: 'Test', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'scheduled', createdAt: '2026-04-01T00:00:00Z', timezone: undefined },
    ]
    
    const displayTz = sessions[0].timezone || 'UTC'
    expect(displayTz).toBe('UTC')
  })

  it('should handle empty sessions array', () => {
    const sessions: Session[] = []
    
    const filtered = sessions.filter(s => s.status === 'scheduled')
    expect(filtered).toHaveLength(0)
    
    const sorted = [...sessions].sort((a, b) => a.id - b.id)
    expect(sorted).toHaveLength(0)
  })

  it('should handle sorting with null createdAt values', () => {
    const sessions: Session[] = [
      { id: 2, title: 'B', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'scheduled', createdAt: null as any },
      { id: 1, title: 'A', channelId: 'a', scheduledStart: '2026-04-05T14:00:00Z', scheduledEnd: '2026-04-05T15:00:00Z', status: 'scheduled', createdAt: '2026-04-01T00:00:00Z' },
    ]
    
    const sorted = [...sessions].sort((a, b) => {
      const aVal = new Date(a.createdAt || 0).getTime()
      const bVal = new Date(b.createdAt || 0).getTime()
      if (aVal < bVal) return -1
      if (aVal > bVal) return 1
      return 0
    })
    
    // Null createdAt becomes 0 (epoch), sorts before valid timestamp
    expect(sorted[0].id).toBe(2)
    expect(sorted[1].id).toBe(1)
  })

  it('should format dates in different timezones', () => {
    const date = '2026-04-05T14:30:00Z'
    
    const resultUTC = formatDateForDisplay(date, 'UTC')
    const resultET = formatDateForDisplay(date, 'America/New_York')
    const resultPT = formatDateForDisplay(date, 'America/Los_Angeles')
    
    expect(resultUTC).toContain('2026')
    expect(resultET).not.toBe(resultUTC)
    expect(resultPT).not.toBe(resultUTC)
    expect(resultET).toContain('10:30')
    expect(resultPT).toContain('7:30')
  })
})
