/**
 * iCalendar (RFC 5545) generation for scheduled cards.
 *
 * A scheduled card projects to a single VEVENT (scheduleKind 'event') or
 * VTODO ('task'). Recurrence, timezones-by-reference (VTIMEZONE), and
 * attendees are deliberately out of scope: timed values are written in UTC,
 * all-day values as DATE. This keeps the output tiny and universally
 * importable, and matches the v1 scope of the CalDAV platform
 * (sockethub/sockethub#1189).
 */
import type { InboxItem } from '@inbox-rs/rs-module';

/** Rejecting the C0 control range is the point: a CR/LF inside a verbatim
 *  URI value would break out of its content line (property injection). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: see above
const CONTROL_CHARS = /[\u0000-\u001f]/;

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline must be escaped. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: content lines longer than 75 octets must be folded with
 * CRLF + single space. Folding is done on UTF-8 byte length — splitting a
 * multi-byte character across a fold produces invalid UTF-8.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  // Continuation lines start with a space, which counts toward the 75.
  let limit = 75;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit) {
      out.push(current);
      current = ' ';
      currentBytes = 1;
      limit = 75;
    }
    current += ch;
    currentBytes += chBytes;
  }
  out.push(current);
  return out.join('\r\n');
}

/** 20260731T090000Z — the UTC instant form. */
function toUtcStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * 20260731 — the DATE form, taken in *local* time. All-day pickers produce
 * a local calendar date; converting through UTC would shift the day for
 * anyone east of Greenwich scheduling before their UTC offset past midnight.
 */
function toDateStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** DATE + n days, for the exclusive DTEND of all-day events. */
function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export interface IcsResult {
  /** Full VCALENDAR text, CRLF line endings. */
  text: string;
  /** Suggested download filename. */
  filename: string;
}

/**
 * Build a single-entry VCALENDAR for a scheduled item. Returns null when the
 * item has no startsAt — callers should treat that as "nothing to export".
 */
export function buildIcs(
  item: InboxItem,
  now: Date = new Date(),
): IcsResult | null {
  if (!item.startsAt) return null;
  const isTask = item.scheduleKind === 'task';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//inbox-rs//EN',
    isTask ? 'BEGIN:VTODO' : 'BEGIN:VEVENT',
    // Stable UID: re-importing an updated .ics replaces the prior entry
    // instead of duplicating it.
    `UID:${escapeText(item.id)}@inbox-rs`,
    `DTSTAMP:${toUtcStamp(now.toISOString())}`,
    `SUMMARY:${escapeText(item.title || 'Untitled')}`,
  ];

  if (isTask) {
    if (item.allDay) {
      lines.push(`DUE;VALUE=DATE:${toDateStamp(item.startsAt)}`);
    } else {
      lines.push(`DUE:${toUtcStamp(item.startsAt)}`);
    }
    if (item.completed) lines.push('STATUS:COMPLETED');
  } else if (item.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${toDateStamp(item.startsAt)}`);
    // DTEND is exclusive: a one-day event ends the following day.
    lines.push(
      `DTEND;VALUE=DATE:${toDateStamp(addDays(item.endsAt ?? item.startsAt, 1))}`,
    );
  } else {
    lines.push(`DTSTART:${toUtcStamp(item.startsAt)}`);
    if (item.endsAt) lines.push(`DTEND:${toUtcStamp(item.endsAt)}`);
  }

  if (item.description) {
    lines.push(`DESCRIPTION:${escapeText(item.description)}`);
  }
  // URL is a URI value type (RFC 5545 §3.3.13) — TEXT backslash-escaping
  // does not apply and would corrupt commas/semicolons in query strings.
  // Emit verbatim; CONTROL_CHARS guards against content-line breakout.
  if (item.type === 'bookmark' && item.url && !CONTROL_CHARS.test(item.url)) {
    lines.push(`URL:${item.url}`);
  }

  lines.push(isTask ? 'END:VTODO' : 'END:VEVENT', 'END:VCALENDAR');

  const safeTitle = (item.title || 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return {
    text: `${lines.map(foldLine).join('\r\n')}\r\n`,
    filename: `${safeTitle || 'event'}.ics`,
  };
}

/** Trigger a browser download of the item's .ics. No-op when unscheduled. */
export function downloadIcs(item: InboxItem): void {
  const ics = buildIcs(item);
  if (!ics) return;
  const blob = new Blob([ics.text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ics.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
