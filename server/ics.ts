import type { Session } from "@shared/schema";

/**
 * Formats a Date to iCalendar DATETIME format: YYYYMMDDTHHmmssZ
 * All times are converted to UTC.
 */
export function formatICSDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

/**
 * Escapes special characters in iCalendar text values.
 * Per RFC 5545: backslash, semicolon, comma, and newlines must be escaped.
 */
export function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Generates a valid iCalendar (.ics) file content for a session.
 * Uses VEVENT with DTSTART, DTEND, SUMMARY, DESCRIPTION, and a 15-minute VALARM reminder.
 *
 * @param session - The session to generate an ICS event for.
 * @param baseUrl - Optional base URL for the event URL field (e.g. "https://example.com").
 * @returns The .ics file content as a string.
 */
export function generateICS(session: Session, baseUrl?: string): string {
  const now = new Date();
  const uid = `session-${session.id}@massively-social-ebook`;
  const dtStart = formatICSDate(session.scheduledStart);
  const dtEnd = formatICSDate(session.scheduledEnd);
  const dtStamp = formatICSDate(now);
  const summary = escapeICSText(session.title);
  const description = escapeICSText(
    session.description || `Live story session on the ${session.channelId} channel.`
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MassivelySocialEbook//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
  ];

  if (baseUrl) {
    lines.push(`URL:${baseUrl}`);
  }

  // 15-minute reminder alarm
  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${summary} starts in 15 minutes!`,
    'END:VALARM',
  );

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n') + '\r\n';
}
