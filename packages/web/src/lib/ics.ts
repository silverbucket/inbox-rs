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
import type { ScheduleKind } from './schedule';

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

/**
 * The link a calendar entry should carry: a bookmark's URL, or the URL line
 * a calendar import left as a note's whole body.
 */
export function entryUrl(item: InboxItem): string | undefined {
  if (item.type === 'bookmark') return item.url || undefined;
  if (item.type === 'note' && /^https?:\/\/\S+$/.test(item.body)) {
    return item.body;
  }
  return undefined;
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
  if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`);
  // URL is a URI value type (RFC 5545 §3.3.13) — TEXT backslash-escaping
  // does not apply and would corrupt commas/semicolons in query strings.
  // Emit verbatim; CONTROL_CHARS guards against content-line breakout.
  const url = entryUrl(item);
  if (url && !CONTROL_CHARS.test(url)) lines.push(`URL:${url}`);

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

// ---------------------------------------------------------------------------
// Reading. A dropped or uploaded .ics (a mail invite, a Meetup/Luma export)
// becomes a scheduled card. Only the first VEVENT/VTODO is read; recurrence,
// alarms, attendees and the embedded VTIMEZONE are ignored — the IANA name
// in a TZID parameter is enough to place a wall-clock time.

export interface ParsedIcs {
  title: string;
  /** The URL line, when the entry carries one. */
  body: string;
  /** DESCRIPTION, unescaped: the card's preview text and what exports emit. */
  description?: string;
  location?: string;
  kind: ScheduleKind;
  start: Date;
  /** Timed events: the end instant. All-day events: the inclusive last day. */
  end?: Date;
  allDay: boolean;
  /** VTODO with STATUS:COMPLETED. */
  completed: boolean;
  /** The COMPLETED instant, when the entry records one. */
  completedAt?: Date;
}

/** True for files worth parsing as a calendar entry. */
export function isCalendarFile(file: File): boolean {
  return file.type === 'text/calendar' || /\.ics$/i.test(file.name);
}

/** RFC 5545 §3.1: a line break followed by a space or tab joins lines. */
function unfoldLines(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** `NAME;PARAM=v;OTHER="a:b":value` — the first `:` outside quotes splits. */
function parseProperty(line: string): IcsProperty | null {
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name, ...paramParts] = line.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      params[part.slice(0, eq).toUpperCase()] = part
        .slice(eq + 1)
        .replace(/^"|"$/g, '');
    }
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

/** Inverse of escapeText. */
export function unescapeText(value: string): string {
  // One pass, so a decoded backslash is never re-read as an escape.
  return value.replace(/\\([\\;,nN])/g, (_, c: string) =>
    c === 'n' || c === 'N' ? '\n' : c,
  );
}

/** True when the fields name a real calendar date and time (no rollover). */
function fieldsExist(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): boolean {
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === mo - 1 &&
    probe.getUTCDate() === d &&
    probe.getUTCHours() === h &&
    probe.getUTCMinutes() === mi &&
    probe.getUTCSeconds() === s
  );
}

/**
 * Wall-clock fields in an IANA zone → instant, using Intl alone. The
 * candidate offsets are those in effect a day either side of the wall-clock
 * reading; a candidate is valid when the zone really has that offset at the
 * resulting instant. An ambiguous fall-back time takes its first occurrence;
 * a time inside a spring-forward gap keeps the pre-transition offset, so
 * 02:30 on the gap day lands at 03:30 DST rather than an hour early. Throws
 * RangeError for a zone Intl doesn't know.
 */
function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): Date {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const offsetAt = (t: number) => {
    const parts = fmt.formatToParts(new Date(t));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value);
    return (
      Date.UTC(
        get('year'),
        get('month') - 1,
        get('day'),
        get('hour'),
        get('minute'),
        get('second'),
      ) - t
    );
  };
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const DAY = 86_400_000;
  const before = offsetAt(asUtc - DAY);
  const offsets = new Set([before, offsetAt(asUtc), offsetAt(asUtc + DAY)]);
  const valid = [...offsets]
    .map((o) => asUtc - o)
    .filter((t) => offsetAt(t) === asUtc - t);
  return new Date(valid.length ? Math.min(...valid) : asUtc - before);
}

/**
 * The three RFC 5545 DATE-TIME forms plus DATE: `20261109T180000Z` (UTC),
 * `20261109T180000` with `TZID=` (zoned) or without (floating local), and
 * `20261109` / `VALUE=DATE` (all-day, local calendar date).
 */
export function parseIcsDate(
  value: string,
  params: Record<string, string> = {},
): { date: Date; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, mi, s] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  // The Date constructors roll 20260230 over to March 2; a date that does
  // not exist is a malformed file, not a schedule.
  if (!fieldsExist(y, mo, d, h, mi, s)) return null;
  if (params.VALUE === 'DATE' || !m[4]) {
    return { date: new Date(y, mo - 1, d), allDay: true };
  }
  if (m[7])
    return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  if (params.TZID) {
    try {
      return {
        date: zonedToUtc(y, mo, d, h, mi, s, params.TZID),
        allDay: false,
      };
    } catch {
      // shortcut: Outlook's Windows zone names ("Central Standard Time")
      // aren't IANA and fall through to floating local time; add an alias
      // table if invites from Outlook land hours off.
    }
  }
  return { date: new Date(y, mo - 1, d, h, mi, s), allDay: false };
}

/** Parse the first VEVENT/VTODO of an iCalendar text; null when there is none. */
export function parseIcs(text: string): ParsedIcs | null {
  let kind: ScheduleKind | null = null;
  const open: string[] = []; // components open before the entry starts
  let depth = 0; // nested VALARM etc. inside the entry
  const props: Record<string, IcsProperty> = {};
  for (const line of unfoldLines(text)) {
    const prop = parseProperty(line);
    if (!prop) continue;
    const component = prop.value.trim().toUpperCase();
    if (kind === null) {
      if (prop.name === 'END') {
        open.pop();
      } else if (prop.name === 'BEGIN') {
        // Only an entry whose direct parent is VCALENDAR counts.
        const direct = open.length === 1 && open[0] === 'VCALENDAR';
        if (direct && component === 'VEVENT') kind = 'event';
        else if (direct && component === 'VTODO') kind = 'task';
        else open.push(component);
      }
      continue;
    }
    if (prop.name === 'BEGIN') {
      depth++;
    } else if (prop.name === 'END') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && !(prop.name in props)) {
      props[prop.name] = prop;
    }
  }
  if (!kind) return null;
  const startProp = (kind === 'task' && props.DUE) || props.DTSTART;
  const start = startProp && parseIcsDate(startProp.value, startProp.params);
  if (!start) return null;
  let end =
    kind === 'event' && props.DTEND
      ? parseIcsDate(props.DTEND.value, props.DTEND.params)
      : null;
  // RFC 5545 requires DTEND's value type to match DTSTART's; mixed bounds
  // are ambiguous, so keep the start alone rather than guess the span.
  if (end && end.allDay !== start.allDay) end = null;
  // An all-day DTEND is exclusive; store the inclusive last day.
  if (end?.allDay) end.date.setDate(end.date.getDate() - 1);
  const field = (name: string) =>
    props[name]
      ? unescapeText(props[name].value).trim() || undefined
      : undefined;
  const summary = field('SUMMARY');
  const status = props.STATUS?.value.trim().toUpperCase();
  const untitled = kind === 'task' ? 'Untitled task' : 'Untitled event';
  return {
    title: `${status === 'CANCELLED' ? 'Cancelled: ' : ''}${summary ?? untitled}`,
    body: props.URL?.value.trim() ?? '',
    description: field('DESCRIPTION'),
    location: field('LOCATION'),
    kind,
    start: start.date,
    end: end && end.date > start.date ? end.date : undefined,
    allDay: start.allDay,
    completed: kind === 'task' && status === 'COMPLETED',
    completedAt: props.COMPLETED
      ? parseIcsDate(props.COMPLETED.value, props.COMPLETED.params)?.date
      : undefined,
  };
}
