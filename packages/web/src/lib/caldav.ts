/**
 * CalDAV client for the sockethub `caldav` platform.
 *
 * The browser can't speak CalDAV directly (no CORS on calendar servers), so
 * every operation relays through Sockethub's HTTP actions endpoint: one POST
 * carrying `[credentials, message]`. The relay holds the password only for
 * the life of that request — encrypted, in a request-scoped store that is
 * purged on teardown — so nothing is persisted server-side, though the relay
 * operator is trusted for that window (hence the per-account pinned endpoint
 * and the insistence on revocable app-specific passwords).
 * Responses stream back as NDJSON.
 *
 * Contract (see sockethub packages/platform-caldav):
 * - timed values must carry a UTC offset — our ISO `...Z` strings qualify
 * - all-day values must be date-only `YYYY-MM-DD` in the user's local day
 * - client-supplied UIDs are allowed — we always use `<itemId>@inbox-rs`
 * - failures arrive as machine-readable `caldav:*` codes
 *
 * This client only discovers calendars and CREATES entries. Publishing is
 * one-shot by design — no updates, no deletes (see note at end of file).
 */
import type { InboxItem } from '@inbox-rs/rs-module';
import { toDateInputValue } from './schedule';

export const CALDAV_CONTEXT = [
  'https://www.w3.org/ns/activitystreams',
  'https://sockethub.org/ns/context/v1.jsonld',
  'https://sockethub.org/ns/context/platform/caldav/v1.jsonld',
];

const REQUEST_TIMEOUT_MS = 30_000;

export interface CaldavCredentials {
  url: string;
  username: string;
  password: string;
}

export interface RemoteCalendar {
  id: string;
  name: string;
  color?: string;
  components: Array<'event' | 'task'>;
}

/** Human-readable messages for the platform's machine codes. */
const ERROR_MESSAGES: Record<string, string> = {
  'caldav:authentication-failed':
    'Sign-in failed — check the username and app password',
  'caldav:connection-failed': 'Could not reach the calendar server',
  'caldav:not-caldav': 'That server does not speak CalDAV',
  'caldav:https-required': 'The calendar server must use https',
  'caldav:conflict': 'The entry changed in your calendar app',
  'caldav:not-found': 'The entry no longer exists on the server',
  'caldav:invalid-calendar': 'That calendar was not found on the server',
  'caldav:unsupported-component':
    'That calendar does not support this entry type',
  // Client-side code: the relay itself was unreachable (offline, DNS, or
  // the 30 s timeout) — distinct from the calendar server being down.
  'caldav:relay-unreachable':
    'Could not reach the calendar relay — are you offline?',
};

export class CaldavError extends Error {
  /** `caldav:<code>`, or `caldav:unknown` when the server said something else. */
  readonly code: string;

  constructor(raw: string) {
    const match = /caldav:[a-z-]+/.exec(raw);
    const code = match ? match[0] : 'caldav:unknown';
    super(ERROR_MESSAGES[code] ?? raw);
    this.code = code;
  }
}

/** Stable actor for the credentials store; identifies the account, not a URL. */
function actorFor(creds: CaldavCredentials) {
  let host = creds.url;
  try {
    host = new URL(creds.url).host;
  } catch {
    // keep raw url — the server will reject invalid credentials anyway
  }
  return { id: `caldav://${creds.username}@${host}`, type: 'person' };
}

function credentialsPayload(creds: CaldavCredentials) {
  return {
    '@context': CALDAV_CONTEXT,
    type: 'credentials',
    actor: actorFor(creds),
    object: {
      type: 'credentials',
      url: creds.url,
      username: creds.username,
      password: creds.password,
    },
  };
}

/**
 * POST `[credentials, message]` and return the message's result line.
 * NDJSON lines that are neither an error nor the expected result (the
 * credentials ack, whatever its shape) are skipped.
 */
async function send(
  creds: CaldavCredentials,
  message: Record<string, unknown>,
  expectTypes: string[],
  endpoint: string,
): Promise<Record<string, unknown>> {
  // Normalize transport failures (network down, DNS, the timeout's
  // DOMException) into coded CaldavErrors — callers branch on `.code` and a
  // raw TypeError would bypass every one of those checks.
  let res: Response;
  let text: string;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify([
        credentialsPayload(creds),
        { '@context': CALDAV_CONTEXT, actor: actorFor(creds), ...message },
      ]),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CaldavError('caldav:relay-unreachable');
  }
  if (!res.ok) {
    throw new CaldavError(`calendar relay responded with ${res.status}`);
  }
  try {
    text = await res.text();
  } catch {
    throw new CaldavError('caldav:relay-unreachable');
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      continue;
    }
    const p = payload as Record<string, unknown>;
    if (typeof p.error === 'string' && p.error) {
      throw new CaldavError(p.error);
    }
    if (typeof p.type === 'string' && expectTypes.includes(p.type)) {
      return p;
    }
  }
  throw new CaldavError('calendar relay returned no result');
}

/** Discover the account's calendars (used at connect time and on refresh). */
export async function fetchCalendars(
  creds: CaldavCredentials,
  endpoint: string,
): Promise<RemoteCalendar[]> {
  const result = await send(creds, { type: 'fetch' }, ['collection'], endpoint);
  const items = Array.isArray(result.items) ? result.items : [];
  // Validate the full RemoteCalendar shape — an entry missing `components`
  // would blow up later in pickPreferredCalendar/the picker UI, far from
  // the malformed response that caused it.
  return items.filter((item): item is RemoteCalendar => {
    const c = item as Partial<RemoteCalendar> | null;
    return (
      !!c &&
      typeof c.id === 'string' &&
      (c as { type?: string }).type === 'calendar' &&
      typeof c.name === 'string' &&
      Array.isArray(c.components)
    );
  });
}

/** The UID we stamp on every entry; derivable from the item forever after. */
export function uidFor(item: Pick<InboxItem, 'id'>): string {
  return `${item.id}@inbox-rs`;
}

/**
 * Map a scheduled item onto the platform's event/task object. Exported for
 * tests. Returns null when the item carries no schedule.
 */
export function itemToCalendarObject(
  item: InboxItem,
): Record<string, unknown> | null {
  if (!item.startsAt) return null;
  const isTask = item.scheduleKind === 'task';
  const allDay = item.allDay === true;
  // All-day entries are calendar dates in the user's local day; timed
  // entries are instants (our stored ISO strings end in Z — a UTC offset).
  const when = allDay
    ? toDateInputValue(new Date(item.startsAt))
    : item.startsAt;
  const base: Record<string, unknown> = {
    type: isTask ? 'task' : 'event',
    uid: uidFor(item),
    name: item.title || 'Untitled',
    ...(allDay ? { allDay: true } : {}),
    ...(item.description ? { content: item.description } : {}),
    ...(item.type === 'bookmark' && item.url ? { url: item.url } : {}),
  };
  if (isTask) {
    base.due = when;
    if (item.completed) {
      base.status = 'completed';
      base.completedTime = item.completedAt ?? new Date().toISOString();
    }
    return base;
  }
  base.startTime = when;
  if (!allDay && item.endsAt) base.endTime = item.endsAt;
  return base;
}

export interface PostedEntry {
  eventUrl: string;
  eventEtag?: string;
}

function mutationResult(result: Record<string, unknown>): PostedEntry {
  const object = (result.object ?? {}) as { id?: string; etag?: string };
  if (!object.id) throw new CaldavError('calendar relay returned no entry id');
  return { eventUrl: object.id, eventEtag: object.etag };
}

/** Create the item's entry in the given calendar. */
export async function createEntry(
  creds: CaldavCredentials,
  calendarId: string,
  item: InboxItem,
  endpoint: string,
): Promise<PostedEntry> {
  const object = itemToCalendarObject(item);
  if (!object) throw new CaldavError('item has no schedule');
  const result = await send(
    creds,
    {
      type: 'create',
      target: { id: calendarId, type: 'calendar' },
      object,
    },
    ['create'],
    endpoint,
  );
  return mutationResult(result);
}

// There are deliberately no update or delete operations here. Publishing is
// one-shot: inbox-rs only ever ADDS entries to the user's calendar, and only
// on explicit request. Entries must never change or disappear because a card
// was edited in the app. (The sockethub platform supports update/delete; this
// client intentionally does not.)
