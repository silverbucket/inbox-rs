/**
 * CalDAV client for the sockethub `caldav` platform.
 *
 * The browser can't speak CalDAV directly (most calendar servers don't expose
 * browser-compatible CORS headers), so every operation relays through
 * Sockethub's HTTP actions endpoint: one POST
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
 * Entries a card sends once are create-only. Updates, deletes and
 * incremental sync serve cards kept in sync (see calendar-sync.ts).
 */
import type { InboxItem } from '@inbox-rs/rs-module';
import { entryUrl } from './ics';
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
  'caldav:sync-unsupported': 'That calendar server does not support sync',
  'caldav:sync-token-invalid': 'The calendar sync position expired',
  'caldav:sync-failed': 'Calendar sync failed',
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
  kind: 'event' | 'task' | undefined = item.scheduleKind,
): Record<string, unknown> | null {
  const isTask = kind === 'task';
  // A task may have no due date; an event needs a start.
  if (!item.startsAt && !isTask) return null;
  const allDay = item.allDay === true && !!item.startsAt;
  // All-day entries are calendar dates in the user's local day; timed
  // entries are instants (our stored ISO strings end in Z — a UTC offset).
  const when = !item.startsAt
    ? undefined
    : allDay
      ? toDateInputValue(new Date(item.startsAt))
      : item.startsAt;
  const base: Record<string, unknown> = {
    type: isTask ? 'task' : 'event',
    uid: uidFor(item),
    name: item.title || 'Untitled',
    ...(allDay ? { allDay: true } : {}),
    ...(item.description ? { content: item.description } : {}),
    ...(item.location ? { location: item.location } : {}),
    ...(entryUrl(item) ? { url: entryUrl(item) } : {}),
  };
  if (isTask) {
    if (when) base.due = when;
    if (item.completed) {
      base.status = 'completed';
      base.completedTime = item.completedAt ?? new Date().toISOString();
    }
    return base;
  }
  if (item.cancelled) base.status = 'cancelled';
  base.startTime = when;
  if (!allDay && item.endsAt) base.endTime = item.endsAt;
  if (allDay && item.endsAt) {
    // platform-caldav takes an all-day end as the exclusive next date.
    const end = new Date(item.endsAt);
    end.setDate(end.getDate() + 1);
    base.endTime = toDateInputValue(end);
  }
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
  kind?: 'event' | 'task',
): Promise<PostedEntry> {
  const object = itemToCalendarObject(item, kind);
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

/** An event or task as the platform returns it from `sync` / `query`. */
export interface RemoteEntry {
  id: string;
  type: 'event' | 'task';
  uid: string;
  etag?: string;
  name: string;
  content?: string;
  location?: string;
  url?: string;
  /** Events. */
  startTime?: string;
  endTime?: string;
  /** Tasks. */
  due?: string;
  allDay?: boolean;
  timeZone?: string;
  status?: string;
  completedTime?: string;
  percentComplete?: number;
  sequence?: number;
  recurrence?: RemoteRecurrence;
  attendees?: unknown[];
  organizer?: unknown;
  updateSupported?: boolean;
  /** Output only: the entry's CREATED / LAST-MODIFIED stamps (UTC). */
  created?: string;
  lastModified?: string;
  [key: string]: unknown;
}

export interface RemoteRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  count?: number;
  until?: string;
  byDay?: string[];
  byMonthDay?: number[];
}

export type RemoteTask = RemoteEntry & { type: 'task' };

export interface SyncResult {
  items: Array<{ id: string; type: string } & Record<string, unknown>>;
  removed: string[];
  syncToken?: string;
  truncated?: boolean;
}

function toSyncResult(result: Record<string, unknown>): SyncResult {
  return {
    items: Array.isArray(result.items)
      ? (result.items as SyncResult['items'])
      : [],
    removed: Array.isArray(result.removed) ? (result.removed as string[]) : [],
    syncToken:
      typeof result.syncToken === 'string' ? result.syncToken : undefined,
    truncated: result.truncated === true,
  };
}

/**
 * RFC 6578 sync of one calendar: the changes since `syncToken`. Without a
 * token it returns everything — callers start from `currentSyncToken`
 * instead, so a calendar's history is never downloaded.
 */
export async function syncCalendar(
  creds: CaldavCredentials,
  calendarId: string,
  syncToken: string | undefined,
  endpoint: string,
): Promise<SyncResult> {
  const result = await send(
    creds,
    {
      type: 'sync',
      target: { id: calendarId, type: 'calendar' },
      ...(syncToken ? { object: { syncToken } } : {}),
    },
    ['collection'],
    endpoint,
  );
  return toSyncResult(result);
}

/** The calendar's current sync token, without any of its entries. */
export async function currentSyncToken(
  creds: CaldavCredentials,
  calendarId: string,
  endpoint: string,
): Promise<string> {
  const result = await send(
    creds,
    {
      type: 'sync',
      target: { id: calendarId, type: 'calendar' },
      object: { tokenOnly: true },
    },
    ['collection'],
    endpoint,
  );
  const token = toSyncResult(result).syncToken;
  if (!token) throw new CaldavError('caldav:sync-unsupported');
  return token;
}

/**
 * A snapshot of one kind of entry. `startTime` limits it to entries that
 * haven't ended before then (CalDAV time-range rules).
 */
export async function queryEntries(
  creds: CaldavCredentials,
  calendarId: string,
  query: { type: 'event' | 'task'; startTime?: string },
  endpoint: string,
): Promise<SyncResult> {
  const result = await send(
    creds,
    {
      type: 'query',
      target: { id: calendarId, type: 'calendar' },
      object: query,
    },
    ['collection'],
    endpoint,
  );
  return toSyncResult(result);
}

/** Full task snapshot — the fallback for servers without WebDAV Sync. */
export function queryTasks(
  creds: CaldavCredentials,
  calendarId: string,
  endpoint: string,
): Promise<SyncResult> {
  return queryEntries(creds, calendarId, { type: 'task' }, endpoint);
}

/** Replace an entry; rejects with `caldav:conflict` when its ETag moved on. */
export async function updateEntry(
  creds: CaldavCredentials,
  calendarId: string,
  object: Record<string, unknown>,
  endpoint: string,
): Promise<PostedEntry> {
  const result = await send(
    creds,
    { type: 'update', target: { id: calendarId, type: 'calendar' }, object },
    ['update'],
    endpoint,
  );
  return mutationResult(result);
}

export async function deleteEntry(
  creds: CaldavCredentials,
  calendarId: string,
  object: { id: string; type: 'event' | 'task'; etag: string },
  endpoint: string,
): Promise<void> {
  await send(
    creds,
    { type: 'delete', target: { id: calendarId, type: 'calendar' }, object },
    ['delete'],
    endpoint,
  );
}
