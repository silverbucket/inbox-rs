/**
 * Two-way sync between cards and CalDAV calendar entries (events and tasks).
 *
 * The rule: a card is on at most one calendar. A collection can be linked to
 * a calendar (`Collection.calendar`): that calendar's new entries arrive in
 * the collection, and todos and dated cards filed there are kept in sync
 * with it. A card can also be kept in sync on its own (`calendarSync`),
 * wherever it lives. Nothing older than today is ever downloaded: a link
 * starts from the calendar's current sync token plus a "today onward"
 * query, and later passes fetch only what changed (RFC 6578).
 *
 * A pass, per calendar this device can reach:
 * 1. Moves: synced cards filed in a collection linked to another calendar
 *    move their entry there (create, then delete the old one).
 * 2. Pull: changes since the token. New entries become cards in the linked
 *    collection (open tasks, events that haven't ended); changes overwrite
 *    their card; entries removed in the calendar unlink their card, which
 *    is kept.
 * 3. Creates: unlinked todos and dated cards in a linked collection get an
 *    entry, unless the user said "not on a calendar" (calendarSync false).
 * 4. Push: cards edited since the last pull/push are written back with an
 *    ETag check. A conflict re-pulls: the calendar wins, with an Undo toast.
 *
 * Tokens, baselines (the last-synced fingerprint and the server's copy, so
 * updates keep fields inbox-rs doesn't model) and status are device-local,
 * like the credentials they depend on.
 */
import type {
  Collection,
  InboxItem,
  NoteItem,
  TodoItem,
} from '@inbox-rs/rs-module';
import { get, writable } from 'svelte/store';
import {
  CaldavError,
  createEntry,
  currentSyncToken,
  deleteEntry,
  itemToCalendarObject,
  queryEntries,
  type RemoteEntry,
  type SyncResult,
  syncCalendar,
  updateEntry,
} from './caldav';
import {
  accountEndpoint,
  type CalendarAccount,
  type CalendarChoice,
  calendarAccounts,
  choiceForCalendar,
  choiceForEventUrl,
  entryInCalendar,
  updateCalendarAccount,
} from './calendar-accounts';
import { describeRecurrence, nextOccurrence } from './recurrence';
import { clearPostedEntry, toDateInputValue } from './schedule';
import {
  collections,
  flushItemChanges,
  items,
  restoreItem,
  restoring,
  storeCollection,
  storeItem,
  updateItem,
} from './stores';
import { showToast } from './toast';

// Kept from the task-only sync, so its baselines and tokens carry over.
const STATE_KEY = 'inbox-rs:task-sync';

interface Baseline {
  /** `fingerprint()` of the card as last synced. */
  fp: string;
  /** The server's copy, the base for updates. */
  remote: RemoteEntry;
}

interface CalendarSyncState {
  token?: string;
  /** The server has no WebDAV Sync: every pass is a "today onward" query. */
  snapshot?: boolean;
  /** Snapshot mode: entries seen at link time and left out on purpose. */
  ignored?: string[];
  /** Keyed by entry href. */
  entries: Record<string, Baseline>;
  lastSync?: string;
  error?: string;
}

type SyncState = Record<string, CalendarSyncState>;

function loadState(): SyncState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveState(state: SyncState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to persist calendar sync state', err);
  }
}

// ---- Status, for the UI ----

export interface CalendarStatus {
  syncing?: boolean;
  lastSync?: string;
  error?: string;
}

function initialStatus(): Record<string, CalendarStatus> {
  return Object.fromEntries(
    Object.entries(loadState()).map(([id, cal]) => [
      id,
      { lastSync: cal.lastSync, error: cal.error },
    ]),
  );
}

/** Per calendar href: when it last synced and the last error, if any. */
export const calendarSyncStatus = writable<Record<string, CalendarStatus>>(
  initialStatus(),
);

/** Per card id: why its entry couldn't be created, moved or saved. */
export const cardSyncErrors = writable<Record<string, string>>({});

function setStatus(calendarId: string, patch: CalendarStatus) {
  calendarSyncStatus.update((all) => ({
    ...all,
    [calendarId]: { ...all[calendarId], ...patch },
  }));
}

function setCardError(id: string, message: string | undefined) {
  cardSyncErrors.update((all) => {
    if (!message && !(id in all)) return all;
    const next = { ...all };
    if (message) next[id] = message;
    else delete next[id];
    return next;
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---- Which calendars and cards are in play ----

/** The collection linked to `calendarUrl`, if any. */
export function linkedCollection(
  calendarUrl: string,
  all: Record<string, Collection> = get(collections),
): Collection | undefined {
  return Object.values(all).find(
    (c) => !c.archived && c.calendar?.url === calendarUrl,
  );
}

/** The calendar link that governs where a card's entry lives. */
export function collectionLinkFor(
  item: Pick<InboxItem, 'collectionId'>,
  all: Record<string, Collection> = get(collections),
): Collection['calendar'] {
  const col = item.collectionId ? all[item.collectionId] : undefined;
  return col && !col.archived ? col.calendar : undefined;
}

interface SyncTarget {
  account: CalendarAccount;
  calendarId: string;
  name: string;
  components: Array<'event' | 'task'>;
  collection?: Collection;
}

function syncTargets(): SyncTarget[] {
  const allItems = Object.values(get(items));
  const allCollections = get(collections);
  return get(calendarAccounts).flatMap((account) =>
    account.calendars
      .map((c) => ({
        account,
        calendarId: c.id,
        name: c.name,
        components: c.components,
        collection: linkedCollection(c.id, allCollections),
      }))
      .filter(
        (t) =>
          !!t.collection ||
          allItems.some(
            (i) => i.calendarSync && entryInCalendar(i.eventUrl, t.calendarId),
          ),
      ),
  );
}

const isTodoish = (item: InboxItem) => item.isTodo || item.type === 'todo';

/** Start of today, local time — the edge of "nothing in the past". */
export function windowStart(now = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** The entry kind a card would get on a calendar, or null when it can't. */
export function entryKindFor(
  item: InboxItem,
  components: Array<'event' | 'task'>,
  now = new Date(),
): 'event' | 'task' | null {
  if (item.archived) return null;
  if (isTodoish(item)) {
    if (item.completed) return null;
    return components.includes('task') ? 'task' : null;
  }
  if (!item.startsAt) return null;
  const kind = item.scheduleKind ?? 'event';
  if (!components.includes(kind)) return null;
  if (kind === 'event') {
    const end = new Date(item.endsAt ?? item.startsAt);
    if (item.allDay) end.setHours(23, 59, 59, 999);
    if (end < windowStart(now)) return null; // history stays off calendars
  }
  return kind;
}

// ---- Field mapping (exported for tests) ----

/** All-day values are local dates; timed ones are instants. */
function whenValue(iso: string, allDay?: boolean): string {
  return allDay ? toDateInputValue(new Date(iso)) : iso;
}

/** The entry fields inbox-rs owns, from a card. Doubles as the fingerprint. */
export function entryFields(
  item: InboxItem,
  kind: 'event' | 'task',
): Record<string, unknown> {
  const common = {
    name: item.title || 'Untitled',
    ...(item.description ? { content: item.description } : {}),
  };
  if (kind === 'event') {
    let end: string | undefined;
    if (item.endsAt && item.allDay) {
      const next = new Date(item.endsAt);
      next.setDate(next.getDate() + 1); // all-day ends are exclusive
      end = toDateInputValue(next);
    } else if (item.endsAt) {
      end = item.endsAt;
    }
    return {
      ...common,
      ...(item.location ? { location: item.location } : {}),
      ...(item.startsAt
        ? { startTime: whenValue(item.startsAt, item.allDay) }
        : {}),
      ...(end ? { endTime: end } : {}),
      ...(item.allDay ? { allDay: true } : {}),
      ...(item.cancelled ? { status: 'cancelled' } : {}),
    };
  }
  const due = item.startsAt ? whenValue(item.startsAt, item.allDay) : undefined;
  return {
    ...common,
    ...(due ? { due } : {}),
    ...(due && item.allDay ? { allDay: true } : {}),
    status: item.cancelled
      ? 'cancelled'
      : item.completed
        ? 'completed'
        : 'needs-action',
    ...(item.completed && !item.cancelled
      ? { completedTime: item.completedAt ?? item.createdAt }
      : {}),
  };
}

/** Kept for the task-only callers and tests. */
export const taskFields = (item: InboxItem) => entryFields(item, 'task');

const fingerprint = (item: InboxItem, kind: 'event' | 'task') =>
  JSON.stringify(entryFields(item, kind));

/** UTC ms for a wall-clock time in `zone`; the second pass settles DST edges. */
function zonedToUtc(local: string, zone: string): number {
  const wall = Date.parse(`${local.slice(0, 19)}Z`);
  const offset = (t: number) =>
    Date.parse(
      `${new Date(t).toLocaleString('sv-SE', { timeZone: zone }).replace(' ', 'T')}Z`,
    ) - t;
  return wall - offset(wall - offset(wall));
}

function parseWhen(
  value: string,
  allDay: boolean,
  zone?: string,
): Date | undefined {
  let date: Date;
  if (allDay) {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    date = new Date(y, m - 1, d);
  } else if (zone && !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    try {
      date = new Date(zonedToUtc(value, zone));
    } catch {
      date = new Date(value); // unknown zone: read it as device-local
    }
  } else {
    date = new Date(value);
  }
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const isDateOnly = (value?: string) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');

/** An entry's start and end, with a repeating event advanced to its next date. */
function entryTimes(
  entry: RemoteEntry,
  now = new Date(),
): { start?: Date; end?: Date; allDay: boolean } {
  const raw = entry.type === 'task' ? entry.due : entry.startTime;
  // Servers report a DATE value as a bare date, without `allDay`.
  const allDay = !!entry.allDay || isDateOnly(raw);
  let start = raw ? parseWhen(raw, allDay, entry.timeZone) : undefined;
  let end =
    entry.type === 'event' && entry.endTime
      ? parseWhen(entry.endTime, allDay, entry.timeZone)
      : undefined;
  if (allDay && start && end) {
    end = new Date(end);
    end.setDate(end.getDate() - 1); // exclusive → the last day
    if (end <= start) end = undefined;
  }
  if (entry.type === 'event' && start && entry.recurrence) {
    const duration = end ? end.getTime() - start.getTime() : 0;
    const next = nextOccurrence(
      start,
      entry.recurrence,
      windowStart(now),
      allDay ? duration + 86_399_999 : duration,
    );
    if (next) {
      start = next;
      end = end ? new Date(next.getTime() + duration) : undefined;
    }
  }
  return { start, end, allDay };
}

/** Whether a new entry belongs in the app: open tasks, events not yet over. */
export function entryIsCurrent(entry: RemoteEntry, now = new Date()): boolean {
  if (entry.type === 'task') {
    return entry.status !== 'completed' && entry.status !== 'cancelled';
  }
  const { start, end, allDay } = entryTimes(entry, now);
  if (!start) return false;
  const last = new Date(end ?? start);
  if (allDay) last.setHours(23, 59, 59, 999);
  return last >= windowStart(now);
}

/** An entry's values as card fields (undefined clears the field). */
export function itemFieldsFromEntry(
  entry: RemoteEntry,
  now = new Date(),
): Partial<InboxItem> {
  const { start, end, allDay } = entryTimes(entry, now);
  const startsAt = start?.toISOString();
  const stamps = {
    calendarCreatedAt: entry.created,
    calendarChangedAt: entry.lastModified,
  };
  if (entry.type === 'event') {
    return {
      title: entry.name,
      description: entry.content || undefined,
      location: entry.location || undefined,
      startsAt,
      endsAt: end?.toISOString(),
      allDay: startsAt && allDay ? true : undefined,
      scheduleKind: 'event',
      cancelled: entry.status === 'cancelled' ? true : undefined,
      ...stamps,
    };
  }
  const cancelled = entry.status === 'cancelled';
  const completed = entry.status === 'completed' || cancelled;
  return {
    title: entry.name,
    description: entry.content || undefined,
    isTodo: true,
    completed,
    completedAt: completed
      ? (entry.completedTime ?? new Date().toISOString())
      : undefined,
    cancelled: cancelled ? true : undefined,
    startsAt,
    endsAt: undefined,
    allDay: startsAt && allDay ? true : undefined,
    scheduleKind: startsAt ? 'task' : undefined,
    ...stamps,
  };
}

/** Kept for the task-only callers and tests. */
export const itemFieldsFromTask = (task: RemoteEntry) =>
  itemFieldsFromEntry(task);

const MODELLED = [
  'name',
  'content',
  'location',
  'startTime',
  'endTime',
  'due',
  'allDay',
  'timeZone',
  'status',
  'completedTime',
  'percentComplete',
  'created',
  'lastModified',
];

/** The server's copy with inbox-rs's fields laid over it, ready to PUT. */
export function entryUpdateObject(
  remote: RemoteEntry,
  item: InboxItem,
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...remote };
  for (const key of MODELLED) delete rest[key];
  const { timeZone, status, percentComplete } = remote;
  const fields = entryFields(item, remote.type);
  if (remote.type === 'task') {
    // Keep a richer open status (`in-process`) unless completion changed.
    if (fields.status === 'needs-action' && status && status !== 'completed') {
      if (status !== 'cancelled') fields.status = status;
    }
  } else if (!fields.status && status && status !== 'cancelled') {
    fields.status = status; // keep tentative / confirmed
  }
  // The platform rejects a zone on all-day values, and wants local
  // date-times when one is kept.
  const zone = fields.allDay ? undefined : timeZone;
  if (zone) {
    for (const key of ['due', 'startTime', 'endTime']) {
      const value = fields[key];
      if (typeof value === 'string' && !isDateOnly(value)) {
        fields[key] = new Date(value)
          .toLocaleString('sv-SE', { timeZone: zone })
          .replace(' ', 'T');
      }
    }
  }
  return {
    ...rest,
    ...(zone ? { timeZone: zone } : {}),
    // A stale "50% done" would contradict a status we just changed.
    ...(percentComplete !== undefined && fields.status === status
      ? { percentComplete }
      : {}),
    ...fields,
    type: remote.type,
    etag: item.eventEtag || remote.etag,
    sequence: (remote.sequence ?? 0) + 1,
  };
}

/** Kept for the task-only callers and tests. */
export const taskUpdateObject = entryUpdateObject;

function isEntry(entry: SyncResult['items'][number]): entry is RemoteEntry {
  const e = entry as Partial<RemoteEntry>;
  return (
    (e.type === 'task' || e.type === 'event') &&
    typeof e.id === 'string' &&
    typeof e.uid === 'string' &&
    typeof e.name === 'string'
  );
}

export type ReadOnlyReason = 'repeating' | 'attendees' | 'unsupported';

function readOnlyReasonOf(remote: RemoteEntry): ReadOnlyReason | undefined {
  if (remote.recurrence) return 'repeating';
  if (remote.attendees?.length) return 'attendees';
  if (remote.updateSupported === false) return 'unsupported';
  return undefined;
}

/**
 * Why a synced card can't be changed from here, if it can't: repeating
 * entries (completing one would end the series), entries with attendees
 * (an edit would email them), and resources the platform can't rewrite.
 */
export function readOnlyReason(
  item: Pick<InboxItem, 'eventUrl'>,
): ReadOnlyReason | undefined {
  const base = baselineFor(item.eventUrl);
  return base ? readOnlyReasonOf(base.remote) : undefined;
}

/** "Repeats weekly" for a synced repeating entry. */
export function recurrenceLabel(
  item: Pick<InboxItem, 'eventUrl'>,
): string | undefined {
  const rule = baselineFor(item.eventUrl)?.remote.recurrence;
  return rule ? describeRecurrence(rule) : undefined;
}

function baselineIn(state: SyncState, href: string): Baseline | undefined {
  for (const cal of Object.values(state)) {
    if (cal.entries[href]) return cal.entries[href];
  }
  return undefined;
}

function baselineFor(href: string | undefined): Baseline | undefined {
  if (!href) return undefined;
  for (const cal of Object.values(loadState())) {
    if (cal.entries[href]) return cal.entries[href];
  }
  return undefined;
}

const canPush = (base: Baseline) => !readOnlyReasonOf(base.remote);

/**
 * The card for an entry. Our own UIDs carry the item id; foreign entries
 * get an id derived from their href, so a re-import (fresh device, reset
 * token) lands on the same card instead of a duplicate.
 */
async function itemIdFor(entry: RemoteEntry): Promise<string> {
  if (entry.uid.endsWith('@inbox-rs')) return entry.uid.slice(0, -9);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(entry.id),
  );
  const hex = [...new Uint8Array(digest).slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `caldav-${hex}`;
}

function hrefIndex(): Map<string, InboxItem> {
  const index = new Map<string, InboxItem>();
  for (const item of Object.values(get(items))) {
    if (item.eventUrl) index.set(item.eventUrl, item);
  }
  return index;
}

/** A new card for an entry, filed in `collectionId`. */
function cardFromEntry(
  entry: RemoteEntry,
  id: string,
  collectionId: string | undefined,
): InboxItem {
  const now = new Date().toISOString();
  const fields = itemFieldsFromEntry(entry);
  const base = {
    id,
    createdAt: entry.created ?? now,
    importedAt: now,
    ...(collectionId ? { collectionId } : {}),
    ...fields,
    eventUrl: entry.id,
    eventEtag: entry.etag,
    calendarSync: true,
  };
  if (entry.type === 'task') {
    return { ...base, type: 'todo', completed: false } as TodoItem;
  }
  return { ...base, type: 'note', body: '' } as NoteItem;
}

/** File freshly stored cards with ONE collection write (two would 412). */
async function fileInCollection(collectionId: string, ids: string[]) {
  const col = get(collections)[collectionId];
  if (!col || ids.length === 0) return;
  const missing = ids.filter((id) => !col.itemIds.includes(id));
  if (missing.length === 0) return;
  await storeCollection({ ...col, itemIds: [...col.itemIds, ...missing] });
}

// ---- The pass ----

interface Changes {
  items: SyncResult['items'];
  removed: string[];
  /** A snapshot: synced entries absent from it were removed. */
  full: boolean;
  token?: string;
}

/** Open tasks and events that haven't ended, today onward. */
async function windowSnapshot(
  target: Pick<SyncTarget, 'account' | 'calendarId' | 'components'>,
): Promise<RemoteEntry[]> {
  const endpoint = accountEndpoint(target.account);
  const found: RemoteEntry[] = [];
  if (target.components.includes('event')) {
    const events = await queryEntries(
      target.account,
      target.calendarId,
      { type: 'event', startTime: windowStart().toISOString() },
      endpoint,
    );
    found.push(...events.items.filter(isEntry));
  }
  if (target.components.includes('task')) {
    const tasks = await queryEntries(
      target.account,
      target.calendarId,
      { type: 'task' },
      endpoint,
    );
    found.push(...tasks.items.filter(isEntry));
  }
  return found;
}

/** Begin tracking a calendar from now: its current token, no history. */
async function startTracking(
  target: SyncTarget,
  cal: CalendarSyncState,
): Promise<void> {
  try {
    cal.token = await currentSyncToken(
      target.account,
      target.calendarId,
      accountEndpoint(target.account),
    );
    cal.snapshot = false;
  } catch (err) {
    if (!(err instanceof CaldavError && err.code === 'caldav:sync-unsupported'))
      throw err;
    cal.snapshot = true;
    cal.token = undefined;
  }
}

async function fetchChanges(
  target: SyncTarget,
  cal: CalendarSyncState,
): Promise<Changes> {
  if (cal.snapshot) {
    return { items: await windowSnapshot(target), removed: [], full: true };
  }
  const endpoint = accountEndpoint(target.account);
  const changes: Changes = { items: [], removed: [], full: false };
  let token = cal.token;
  try {
    for (;;) {
      const page = await syncCalendar(
        target.account,
        target.calendarId,
        token,
        endpoint,
      );
      changes.items.push(...page.items);
      changes.removed.push(...page.removed);
      token = page.syncToken;
      if (!page.truncated || !token) break;
    }
  } catch (err) {
    if (!(err instanceof CaldavError)) throw err;
    if (err.code === 'caldav:sync-token-invalid') {
      // Restart from now, and reconcile the gap with a "today onward"
      // snapshot so changes made meanwhile aren't skipped.
      await startTracking(target, cal);
      return { items: await windowSnapshot(target), removed: [], full: true };
    }
    if (err.code !== 'caldav:sync-unsupported') throw err;
    cal.snapshot = true;
    return { items: await windowSnapshot(target), removed: [], full: true };
  }
  changes.token = token;
  return changes;
}

interface PassNotes {
  removed: string[];
  imported: number;
}

async function applyRemote(
  entry: RemoteEntry,
  target: SyncTarget,
  cal: CalendarSyncState,
  byHref: Map<string, InboxItem>,
  imports: InboxItem[],
): Promise<void> {
  const base = cal.entries[entry.id];
  const id = await itemIdFor(entry);
  const linked = byHref.get(entry.id);
  const existing = linked ?? get(items)[id];
  if (!existing) {
    if (!target.collection || !entryIsCurrent(entry)) return;
    if (cal.ignored?.includes(entry.id)) return;
    const created = cardFromEntry(entry, id, target.collection.id);
    imports.push(created);
    cal.entries[entry.id] = {
      fp: fingerprint(created, entry.type),
      remote: entry,
    };
    return;
  }
  // "Not on a calendar" (or sent once): the card isn't ours to update.
  if (existing.calendarSync === false) return;
  if (linked && linked.calendarSync !== true) return;
  if (!linked && existing.eventUrl) return; // linked to another entry
  if (
    base &&
    existing.eventUrl === entry.id &&
    existing.eventEtag === entry.etag &&
    entry.etag
  ) {
    // Unchanged on the server: refresh the copy, keep any pending local edit.
    cal.entries[entry.id] = { fp: base.fp, remote: entry };
    return;
  }
  const localEdit = !!base && fingerprint(existing, entry.type) !== base.fp;
  const next = await updateItem(existing.id, (current) =>
    current
      ? ({
          ...current,
          ...itemFieldsFromEntry(entry),
          eventUrl: entry.id,
          eventEtag: entry.etag,
          calendarSync: true,
          // A synced calendar shares the card; it no longer owns it.
          ...(current.archiveReason === 'calendar'
            ? {
                archived: undefined,
                archivedAt: undefined,
                archiveReason: undefined,
              }
            : {}),
        } as InboxItem)
      : null,
  );
  if (!next) return;
  cal.entries[entry.id] = { fp: fingerprint(next, entry.type), remote: entry };
  if (!localEdit) return;
  // The link fields match `next`, so Undo restores only the user's edit.
  const before = {
    ...existing,
    eventUrl: next.eventUrl,
    eventEtag: next.eventEtag,
  };
  showToast(
    `“${entry.name}” changed in ${target.name} too — kept that version`,
    {
      label: 'Undo',
      run: () => void restoreItem({ before, after: next }),
    },
  );
}

async function unlinkRemoved(
  href: string,
  cal: CalendarSyncState,
  byHref: Map<string, InboxItem>,
  notes: PassNotes,
) {
  delete cal.entries[href];
  const item = byHref.get(href);
  if (!item) return;
  const next = await updateItem(item.id, (current) =>
    current?.eventUrl === href
      ? { ...clearPostedEntry(current), calendarSync: false }
      : null,
  );
  if (next) notes.removed.push(next.title || 'Untitled');
}

async function pull(
  target: SyncTarget,
  cal: CalendarSyncState,
  notes: PassNotes,
) {
  const changes = await fetchChanges(target, cal);
  const byHref = hrefIndex();
  const imports: InboxItem[] = [];
  for (const entry of changes.items) {
    if (isEntry(entry)) await applyRemote(entry, target, cal, byHref, imports);
  }
  if (imports.length) {
    for (const card of imports) await storeItem(card);
    if (target.collection) {
      await fileInCollection(
        target.collection.id,
        imports.map((c) => c.id),
      );
    }
    notes.imported += imports.length;
  }
  const seen = new Set(changes.items.map((entry) => entry.id));
  const removed = changes.full
    ? Object.keys(cal.entries).filter((href) => {
        if (seen.has(href)) return false;
        // An event that simply ended drops out of a "today onward" query.
        const remote = cal.entries[href].remote;
        if (remote.type === 'event' && !entryIsCurrent(remote)) {
          delete cal.entries[href];
          return false;
        }
        return true;
      })
    : changes.removed;
  for (const href of removed) await unlinkRemoved(href, cal, byHref, notes);
  if (!changes.full) cal.token = changes.token ?? cal.token;
}

/**
 * Repeating events show their next date. Time moves on without the server
 * changing anything, so recompute it from the stored copy every pass.
 */
async function advanceRepeating(cal: CalendarSyncState) {
  const byHref = hrefIndex();
  for (const [href, base] of Object.entries(cal.entries)) {
    if (base.remote.type !== 'event' || !base.remote.recurrence) continue;
    const item = byHref.get(href);
    if (!item?.calendarSync) continue;
    const { startsAt, endsAt } = itemFieldsFromEntry(base.remote);
    if (!startsAt || (startsAt === item.startsAt && endsAt === item.endsAt))
      continue;
    const next = await updateItem(item.id, (current) =>
      current?.eventUrl === href ? { ...current, startsAt, endsAt } : null,
    );
    if (next) cal.entries[href] = { ...base, fp: fingerprint(next, 'event') };
  }
}

/** Synced cards on this calendar that have no baseline get one, once. */
const missingTried = new Set<string>();

async function catchUpBaselines(target: SyncTarget, cal: CalendarSyncState) {
  const missing = Object.values(get(items)).filter(
    (i) =>
      i.calendarSync &&
      i.eventUrl &&
      entryInCalendar(i.eventUrl, target.calendarId) &&
      !cal.entries[i.eventUrl] &&
      !missingTried.has(i.eventUrl),
  );
  if (missing.length === 0) return;
  for (const i of missing) if (i.eventUrl) missingTried.add(i.eventUrl);
  const byHref = hrefIndex();
  const wanted = new Set(missing.map((i) => i.eventUrl));
  for (const entry of await windowSnapshot(target)) {
    if (wanted.has(entry.id)) await applyRemote(entry, target, cal, byHref, []);
  }
}

/** Give unsynced todos and dated cards in the linked collection an entry. */
async function createPending(target: SyncTarget, cal: CalendarSyncState) {
  const col = target.collection;
  if (!col) return;
  const pending = Object.values(get(items)).filter(
    (i) =>
      i.collectionId === col.id &&
      !i.eventUrl &&
      i.calendarSync !== false &&
      entryKindFor(i, target.components),
  );
  for (const item of pending) {
    const kind = entryKindFor(item, target.components);
    if (!kind) continue;
    try {
      const object = itemToCalendarObject(item, kind);
      if (!object) continue;
      const receipt = await createEntry(
        target.account,
        target.calendarId,
        item,
        accountEndpoint(target.account),
        kind,
      );
      const next = await updateItem(item.id, (current) =>
        current && !current.eventUrl
          ? ({
              ...current,
              ...receipt,
              calendarSync: true,
              ...(current.startsAt ? { scheduleKind: kind } : {}),
            } as InboxItem)
          : null,
      );
      if (!next) continue;
      cal.entries[receipt.eventUrl] = {
        // What was uploaded: an edit made meanwhile stays pending.
        fp: fingerprint(item, kind),
        remote: {
          ...object,
          id: receipt.eventUrl,
          etag: receipt.eventEtag,
          updateSupported: true,
        } as RemoteEntry,
      };
      setCardError(item.id, undefined);
    } catch (err) {
      console.error('Failed to add card to calendar', err);
      setCardError(
        item.id,
        `Couldn’t add to ${target.name}: ${errorText(err)}`,
      );
    }
  }
}

/** Push local edits. Returns true when a conflict needs a re-pull. */
async function push(
  target: SyncTarget,
  cal: CalendarSyncState,
): Promise<boolean> {
  let conflict = false;
  const byHref = hrefIndex();
  for (const [href, base] of Object.entries(cal.entries)) {
    const item = byHref.get(href);
    if (!item?.calendarSync || !canPush(base)) continue;
    if (fingerprint(item, base.remote.type) === base.fp) continue;
    // No ETag means no conflict check; wait for a pull to supply one.
    if (!item.eventEtag && !base.remote.etag) continue;
    const object = entryUpdateObject(base.remote, item);
    try {
      const { eventEtag } = await updateEntry(
        target.account,
        target.calendarId,
        object,
        accountEndpoint(target.account),
      );
      cal.entries[href] = {
        fp: fingerprint(item, base.remote.type),
        remote: { ...base.remote, ...object, etag: eventEtag } as RemoteEntry,
      };
      await updateItem(item.id, (current) =>
        current?.eventUrl === href ? { ...current, eventEtag } : null,
      );
      setCardError(item.id, undefined);
    } catch (err) {
      if (err instanceof CaldavError && err.code === 'caldav:conflict') {
        conflict = true;
      } else {
        console.error('Failed to push entry to calendar', err);
        setCardError(
          item.id,
          `Couldn’t save to ${target.name}: ${errorText(err)}`,
        );
      }
    }
  }
  return conflict;
}

/**
 * Move an entry to another calendar: create it there, then delete the old
 * one. Returns the updated card, or throws with nothing changed.
 */
async function moveEntry(
  item: InboxItem,
  to: CalendarChoice,
  state: SyncState,
): Promise<InboxItem> {
  const href = item.eventUrl;
  const from = choiceForEventUrl(href);
  const fromCal = from ? state[from.calendar.id] : undefined;
  const base = href ? fromCal?.entries[href] : undefined;
  // Unknown read-only status (no copy fetched yet on this device): wait.
  if (href && !base) {
    throw new CaldavError('Still syncing this entry — try again in a moment');
  }
  if (base && !canPush(base)) {
    throw new CaldavError(
      'This entry can only be changed in your calendar app',
    );
  }
  const kind =
    base?.remote.type ??
    (isTodoish(item) || item.scheduleKind === 'task' ? 'task' : 'event');
  if (!to.calendar.components.includes(kind)) {
    throw new CaldavError('caldav:unsupported-component');
  }
  const object = itemToCalendarObject(item, kind);
  if (!object) throw new CaldavError('item has no schedule');
  const receipt = await createEntry(
    to.account,
    to.calendar.id,
    item,
    accountEndpoint(to.account),
    kind,
  );
  if (href && from) {
    const etag = item.eventEtag || base?.remote.etag;
    if (etag) {
      try {
        await deleteEntry(
          from.account,
          from.calendar.id,
          { id: href, type: kind, etag },
          accountEndpoint(from.account),
        );
      } catch (err) {
        console.error('Failed to remove the moved entry', err);
        showToast(
          `Copied to ${to.calendar.name}, but couldn’t remove it from ${from.calendar.name}`,
        );
      }
    }
    if (fromCal) delete fromCal.entries[href];
  }
  const next = await updateItem(item.id, (current) =>
    current
      ? ({ ...current, ...receipt, calendarSync: true } as InboxItem)
      : null,
  );
  if (!next) throw new Error('The card is gone');
  state[to.calendar.id] ??= { entries: {} };
  state[to.calendar.id].entries[receipt.eventUrl] = {
    fp: fingerprint(item, kind),
    remote: {
      ...object,
      id: receipt.eventUrl,
      etag: receipt.eventEtag,
      updateSupported: true,
    } as RemoteEntry,
  };
  return next;
}

/** Synced cards filed under another calendar's link follow the link. */
async function followLinks(state: SyncState) {
  const allCollections = get(collections);
  for (const item of Object.values(get(items))) {
    if (!item.calendarSync || !item.eventUrl) continue;
    const link = collectionLinkFor(item, allCollections);
    if (!link || entryInCalendar(item.eventUrl, link.url)) continue;
    const to = choiceForCalendar(link.url);
    if (!to) continue; // another device with the account moves it
    if (!baselineIn(state, item.eventUrl)) continue; // after its first pull
    try {
      await moveEntry(item, to, state);
      setCardError(item.id, undefined);
      showToast(`Moved “${item.title || 'Untitled'}” to ${to.calendar.name}`);
    } catch (err) {
      setCardError(
        item.id,
        `Couldn’t move to ${to.calendar.name}: ${errorText(err)}`,
      );
    }
  }
}

let lastRun = 0;
const toastedErrors = new Set<string>();

async function syncAll(): Promise<void> {
  if (get(restoring)) return;
  lastRun = Date.now();
  flushItemChanges();
  const state = loadState();
  await followLinks(state);
  saveState(state);
  const targets = syncTargets();
  const notes: PassNotes = { removed: [], imported: 0 };
  for (const target of targets) {
    const isNew = !state[target.calendarId];
    state[target.calendarId] ??= { entries: {} };
    const cal = state[target.calendarId];
    setStatus(target.calendarId, { syncing: true });
    try {
      if (isNew || (!cal.token && !cal.snapshot)) {
        await startTracking(target, cal);
      } else {
        await pull(target, cal, notes);
      }
      await catchUpBaselines(target, cal);
      await advanceRepeating(cal);
      await createPending(target, cal);
      if (await push(target, cal)) await pull(target, cal, notes);
      cal.lastSync = new Date().toISOString();
      cal.error = undefined;
      toastedErrors.delete(target.calendarId);
    } catch (err) {
      console.error('Calendar sync failed', err);
      cal.error = errorText(err);
      const relayDown =
        err instanceof CaldavError && err.code === 'caldav:relay-unreachable';
      if (!relayDown && !toastedErrors.has(target.calendarId)) {
        toastedErrors.add(target.calendarId);
        showToast(`Couldn’t sync ${target.name}: ${cal.error}`);
      }
    } finally {
      setStatus(target.calendarId, {
        syncing: false,
        lastSync: cal.lastSync,
        error: cal.error,
      });
      saveState(state);
    }
  }
  if (notes.removed.length === 1) {
    showToast(
      `“${notes.removed[0]}” was removed from its calendar — the card is kept`,
    );
  } else if (notes.removed.length > 1) {
    showToast(
      `${notes.removed.length} entries were removed from their calendar — the cards are kept`,
    );
  }
}

let running: Promise<void> | null = null;
let again = false;

/** Run a sync pass now; a call during a pass queues one more after it. */
export function runCalendarSync(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncAll();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Kept for older call sites. */
export const runTaskSync = runCalendarSync;

function hasPendingWork(): boolean {
  const state = loadState();
  const allCollections = get(collections);
  const byHref = hrefIndex();
  const edited = Object.values(state).some((cal) =>
    Object.entries(cal.entries).some(([href, base]) => {
      const item = byHref.get(href);
      return (
        !!item?.calendarSync &&
        canPush(base) &&
        fingerprint(item, base.remote.type) !== base.fp
      );
    }),
  );
  if (edited) return true;
  return Object.values(get(items)).some((item) => {
    const link = collectionLinkFor(item, allCollections);
    if (!link) return false;
    if (item.calendarSync && item.eventUrl) {
      return !entryInCalendar(item.eventUrl, link.url);
    }
    const choice = choiceForCalendar(link.url);
    return (
      !item.eventUrl &&
      item.calendarSync !== false &&
      !!choice &&
      !!entryKindFor(item, choice.calendar.components)
    );
  });
}

// ---- Actions from the UI ----

/** What linking `choice` would bring in, today onward. */
export interface LinkPreview {
  choice: CalendarChoice;
  token?: string;
  snapshot: boolean;
  events: RemoteEntry[];
  tasks: RemoteEntry[];
  /** Entries that already have a card (they'll move into the collection). */
  existing: Record<string, string>;
}

export async function previewLink(
  choice: CalendarChoice,
): Promise<LinkPreview> {
  const endpoint = accountEndpoint(choice.account);
  let token: string | undefined;
  let snapshot = false;
  // Read the token first, so nothing changed during the query is missed.
  try {
    token = await currentSyncToken(
      choice.account,
      choice.calendar.id,
      endpoint,
    );
  } catch (err) {
    if (!(err instanceof CaldavError && err.code === 'caldav:sync-unsupported'))
      throw err;
    snapshot = true;
  }
  const entries = (
    await windowSnapshot({
      account: choice.account,
      calendarId: choice.calendar.id,
      components: choice.calendar.components,
    })
  ).filter((e) => entryIsCurrent(e));
  const byHref = hrefIndex();
  const existing: Record<string, string> = {};
  for (const entry of entries) {
    const card = byHref.get(entry.id) ?? get(items)[await itemIdFor(entry)];
    if (card) existing[entry.id] = card.id;
  }
  const byDate = (a: RemoteEntry, b: RemoteEntry) =>
    (entryTimes(a).start?.getTime() ?? Infinity) -
    (entryTimes(b).start?.getTime() ?? Infinity);
  return {
    choice,
    token,
    snapshot,
    events: entries.filter((e) => e.type === 'event').sort(byDate),
    tasks: entries.filter((e) => e.type === 'task').sort(byDate),
    existing,
  };
}

/** Cards in `collection` that linking would add to the calendar. */
export function cardsToAdd(
  collection: Collection,
  components: Array<'event' | 'task'>,
): InboxItem[] {
  return Object.values(get(items)).filter(
    (i) =>
      i.collectionId === collection.id &&
      !i.eventUrl &&
      i.calendarSync !== false &&
      !!entryKindFor(i, components),
  );
}

/**
 * Link `collection` to the previewed calendar: bring in the chosen entries,
 * and either add the collection's own cards to the calendar or mark them
 * "not on a calendar".
 */
export async function linkCollection(
  collection: Collection,
  preview: LinkPreview,
  options: { importIds: Set<string>; addExisting: boolean },
): Promise<number> {
  const { choice } = preview;
  const calendarId = choice.calendar.id;
  if (!options.addExisting) {
    for (const card of cardsToAdd(collection, choice.calendar.components)) {
      await updateItem(card.id, (current) =>
        current ? { ...current, calendarSync: false } : null,
      );
    }
  }
  await storeCollection({
    ...collection,
    calendar: {
      url: calendarId,
      name: choice.calendar.name,
      ...(choice.calendar.color ? { color: choice.calendar.color } : {}),
    },
  });
  const state = loadState();
  const cal: CalendarSyncState = {
    token: preview.token,
    snapshot: preview.snapshot,
    entries: state[calendarId]?.entries ?? {},
  };
  const chosen = [...preview.events, ...preview.tasks].filter((e) =>
    options.importIds.has(e.id),
  );
  if (preview.snapshot) {
    cal.ignored = [...preview.events, ...preview.tasks]
      .filter((e) => !options.importIds.has(e.id))
      .map((e) => e.id);
  }
  const fresh: InboxItem[] = [];
  const moved: string[] = [];
  for (const entry of chosen) {
    const existingId = preview.existing[entry.id];
    const current = existingId ? get(items)[existingId] : undefined;
    if (current) {
      const next = await updateItem(current.id, (c) =>
        c
          ? ({
              ...c,
              ...itemFieldsFromEntry(entry),
              collectionId: collection.id,
              eventUrl: entry.id,
              eventEtag: entry.etag,
              calendarSync: true,
              archived: undefined,
              archivedAt: undefined,
              archiveReason: undefined,
            } as InboxItem)
          : null,
      );
      if (next) {
        moved.push(next.id);
        if (current.collectionId && current.collectionId !== collection.id) {
          const old = get(collections)[current.collectionId];
          if (old) {
            await storeCollection({
              ...old,
              itemIds: old.itemIds.filter((id) => id !== next.id),
            });
          }
        }
        cal.entries[entry.id] = {
          fp: fingerprint(next, entry.type),
          remote: entry,
        };
      }
      continue;
    }
    const card = cardFromEntry(entry, await itemIdFor(entry), collection.id);
    fresh.push(card);
    cal.entries[entry.id] = {
      fp: fingerprint(card, entry.type),
      remote: entry,
    };
  }
  for (const card of fresh) await storeItem(card);
  await fileInCollection(collection.id, [...fresh.map((c) => c.id), ...moved]);
  state[calendarId] = cal;
  saveState(state);
  // The legacy "sync into unfiled todos" marker is settled by linking.
  if (choice.account.syncCalendarIds?.includes(calendarId)) {
    updateCalendarAccount(choice.account.id, {
      syncCalendarIds: choice.account.syncCalendarIds.filter(
        (id) => id !== calendarId,
      ),
    });
  }
  void runCalendarSync();
  return fresh.length + moved.length;
}

/**
 * Unlink a collection from its calendar. Cards stay in the collection and
 * entries stay in the calendar; they just stop syncing.
 */
export async function unlinkCollection(collection: Collection): Promise<void> {
  const url = collection.calendar?.url;
  if (!url) return;
  const { calendar: _drop, ...rest } = collection;
  await storeCollection(rest as Collection);
  for (const item of Object.values(get(items))) {
    if (item.collectionId !== collection.id) continue;
    if (item.calendarSync === false && !item.eventUrl) {
      await updateItem(item.id, (c) =>
        c ? { ...c, calendarSync: undefined } : null,
      );
      continue;
    }
    if (!item.calendarSync || !entryInCalendar(item.eventUrl, url)) continue;
    await updateItem(item.id, (c) =>
      c ? { ...clearPostedEntry(c), calendarSync: undefined } : null,
    );
  }
  const state = loadState();
  delete state[url];
  saveState(state);
}

/**
 * Stop syncing one card. Its entry stays in the calendar and the card keeps
 * the link as a receipt, so it reads as "sent once".
 */
export async function stopSyncing(item: InboxItem): Promise<InboxItem | null> {
  const href = item.eventUrl;
  const next = await updateItem(item.id, (c) =>
    c ? { ...c, calendarSync: false } : null,
  );
  forgetBaseline(href);
  setCardError(item.id, undefined);
  return next;
}

/** Delete the card's entry from its calendar and stop syncing the card. */
export async function removeFromCalendar(item: InboxItem): Promise<void> {
  await deleteRemoteEntry(item);
  await updateItem(item.id, (c) =>
    c ? { ...clearPostedEntry(c), calendarSync: false } : null,
  );
  setCardError(item.id, undefined);
}

/** Keep a card in sync with `choice` — adding it there, or moving it. */
export async function keepInSync(
  item: InboxItem,
  choice: CalendarChoice,
): Promise<InboxItem> {
  const state = loadState();
  try {
    if (item.eventUrl && entryInCalendar(item.eventUrl, choice.calendar.id)) {
      // Sent once → kept in sync: start tracking the existing entry.
      const next = await updateItem(item.id, (c) =>
        c ? { ...c, calendarSync: true } : null,
      );
      void runCalendarSync();
      return next ?? item;
    }
    const next = await moveEntry(item, choice, state);
    setCardError(item.id, undefined);
    return next;
  } finally {
    saveState(state);
    void runCalendarSync();
  }
}

/** Card deleted with "only from Inbox RS": the entry stays, untracked. */
export function forgetEntry(item: Pick<InboxItem, 'eventUrl'>): void {
  forgetBaseline(item.eventUrl);
}

function forgetBaseline(href: string | undefined) {
  if (!href) return;
  const state = loadState();
  for (const cal of Object.values(state)) delete cal.entries[href];
  saveState(state);
}

async function deleteRemoteEntry(item: InboxItem): Promise<void> {
  const href = item.eventUrl;
  if (!href) return;
  const target = choiceForEventUrl(href);
  const base = baselineFor(href);
  forgetBaseline(href);
  if (!target) {
    throw new CaldavError(
      'This device isn’t connected to that calendar account',
    );
  }
  // Deleting a repeating entry's resource would take the whole series.
  if (base && !canPush(base)) {
    throw new CaldavError(
      'This entry can only be removed in your calendar app',
    );
  }
  const etag = item.eventEtag || base?.remote.etag;
  if (!etag) throw new CaldavError('caldav:conflict');
  const kind =
    base?.remote.type ??
    (isTodoish(item) || item.scheduleKind === 'task' ? 'task' : 'event');
  await deleteEntry(
    target.account,
    target.calendar.id,
    { id: href, type: kind, etag },
    accountEndpoint(target.account),
  );
}

/**
 * Card deleted in the app: delete its entry too, when the card is synced
 * and the user didn't choose to keep the entry. Called from
 * stores.deleteItem — only an explicit delete reaches here.
 */
export async function deleteSyncedEntry(item: InboxItem): Promise<void> {
  if (!item.calendarSync || !item.eventUrl) {
    forgetBaseline(item.eventUrl);
    return;
  }
  const name =
    choiceForEventUrl(item.eventUrl)?.calendar.name ?? 'its calendar';
  try {
    await deleteRemoteEntry(item);
  } catch (err) {
    console.error('Failed to delete synced entry', err);
    showToast(`Couldn’t remove “${item.title}” from ${name}`);
  }
}

/** Kept for older call sites. */
export const deleteSyncedTask = deleteSyncedEntry;

/** How many cards on this device came from or sync with `calendarUrl`. */
export function calendarCardCount(calendarUrl: string): number {
  return Object.values(get(items)).filter(
    (i) => i.calendarSync && entryInCalendar(i.eventUrl, calendarUrl),
  ).length;
}

/**
 * Legacy "sync into unfiled todos": cards it imported keep syncing (they
 * become individually synced cards), and the calendar is flagged in
 * Settings for linking to a collection.
 */
async function migrateLegacySync() {
  const legacy = get(calendarAccounts).flatMap((a) => a.syncCalendarIds ?? []);
  if (legacy.length === 0) return;
  const state = loadState();
  for (const item of Object.values(get(items))) {
    if (item.calendarSync !== undefined || !item.eventUrl) continue;
    const calendarId = legacy.find((id) => entryInCalendar(item.eventUrl, id));
    if (!calendarId || !state[calendarId]?.entries[item.eventUrl]) continue;
    await updateItem(item.id, (c) => (c ? { ...c, calendarSync: true } : null));
  }
}

let started = false;

/** Sync on load, when the app comes back into view, and after local edits. */
export function initCalendarSync(): void {
  if (started) return;
  started = true;
  const kick = () => {
    if (syncTargets().length > 0) void runCalendarSync();
  };
  restoring.subscribe((value) => {
    if (value) return;
    void migrateLegacySync().then(kick);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRun > 60_000)
      kick();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (hasPendingWork()) kick();
    }, 2000);
  };
  items.subscribe(schedule);
  collections.subscribe(schedule);
}

/** Kept for older call sites. */
export const initTaskSync = initCalendarSync;
