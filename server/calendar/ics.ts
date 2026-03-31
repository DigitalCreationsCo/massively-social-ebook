import { formatInTZ } from "@shared/date";
import type { Session } from "@shared/schema";

/**
 * Formats a Date to iCalendar DATETIME format in UTC: YYYYMMDDTHHmmssZ
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

export function formatICSDateLocal(date: Date, tz: string): string {
    return formatInTZ(date, tz, "yyyyMMdd'T'HHmmss");
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
 * Folds a long line according to RFC 5545 specifications.
 * Lines longer than 75 octets should be folded.
 */
export function foldLine(line: string): string {
  const MAX_LENGTH = 75;
  if (line.length <= MAX_LENGTH) {
    return line;
  }

  let result = '';
  let currentLine = line;

  while (currentLine.length > MAX_LENGTH) {
    // Take first 75 chars
    result += currentLine.substring(0, MAX_LENGTH) + '\r\n ';
    // Remaining chars
    currentLine = currentLine.substring(MAX_LENGTH);
  }
  
  result += currentLine;
  return result;
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
  const dtStart = formatICSDateLocal(session.scheduledStart, session.timezone);
  const dtEnd = formatICSDateLocal(session.scheduledEnd, session.timezone);
  const dtStamp = formatICSDate(now);
  const summary = escapeICSText(`The 25th Chapter: ${session.title}`);
  const description = escapeICSText(
    session.description || `Live story session on the ${session.channelId} channel.`
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The 25th Chapter//NONSGML v1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=${session.timezone}:${dtStart}`,
    `DTEND;TZID=${session.timezone}:${dtEnd}`,
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

  return lines.map(foldLine).join('\r\n') + '\r\n';
}
