import { describe, it, expect } from 'vitest';
import { formatICSDate, generateICS } from './ics';
import type { Session } from '@shared/schema';

describe('ICS Generator', () => {
  describe('formatICSDate', () => {
    it('formats a date correctly to iCalendar format in UTC', () => {
      const date = new Date('2026-03-15T14:30:00Z');
      expect(formatICSDate(date)).toBe('20260315T143000Z');
    });

    it('handles single-digit months and days correctly', () => {
      const date = new Date('2026-01-05T09:05:01Z');
      expect(formatICSDate(date)).toBe('20260105T090501Z');
    });
  });

  describe('generateICS', () => {
    it('generates a valid VEVENT with mandatory fields', () => {
      const mockSession: Session = {
        id: 42,
        channelId: 'scifi',
        title: 'Project Exodus: Breach',
        description: 'The crew discovers a rift in the hull.',
        scheduledStart: new Date('2026-06-01T18:00:00Z'),
        scheduledEnd: new Date('2026-06-01T20:00:00Z'),
        status: 'scheduled',
        createdAt: new Date()
      };

      const ics = generateICS(mockSession);

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('VERSION:2.0');
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain('SUMMARY:Project Exodus: Breach');
      expect(ics).toContain('DESCRIPTION:The crew discovers a rift in the hull.');
      expect(ics).toContain('DTSTART:20260601T180000Z');
      expect(ics).toContain('DTEND:20260601T200000Z');
      expect(ics).toContain('BEGIN:VALARM');
      expect(ics).toContain('TRIGGER:-PT15M');
      expect(ics).toContain('END:VALARM');
      expect(ics).toContain('END:VEVENT');
      expect(ics).toContain('END:VCALENDAR');
    });

    it('escapes characters in components', () => {
      const mockSession: Session = {
        id: 43,
        channelId: 'mystery',
        title: 'Rainy Alley; "The Shadow", Part 1',
        description: 'Line 1\nLine 2',
        scheduledStart: new Date(),
        scheduledEnd: new Date(),
        status: 'scheduled',
        createdAt: new Date()
      };

      const ics = generateICS(mockSession);
      // SUMMARY should escape semicolons/commas
      expect(ics).toContain('SUMMARY:Rainy Alley\\; "The Shadow"\\, Part 1');
      expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2');
    });
  });
});
