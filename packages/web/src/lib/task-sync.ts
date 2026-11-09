/**
 * Two-way task (VTODO) sync with the CalDAV calendars the user opted into
 * on this device (Settings → Calendars → "sync"). Everything else about
 * calendars stays one-shot publishing (schedule-sync.ts).
 *
 * A pass, per synced calendar:
 * 1. Pull: RFC 6578 `sync` from the stored token (full snapshot without
 *    one, `query` when the server lacks WebDAV Sync). New open tasks become
 *    todos, changed ones overwrite their card, removed ones are unlinked —
 *    a card is never deleted because the calendar dropped its task.
 * 2. Push: cards whose synced fields changed since the last pull/push are
 *    written back with an ETag check. A conflict re-pulls: the calendar's
 *    version wins, with an Undo toast that restores the local edit (which
 *    then pushes again).
 *
 * Baselines (last-synced fingerprint + the server's copy of each task, so
 * updates keep fields inbox-rs doesn't model) and sync tokens are
 * device-local, like the credentials they depend on.
 */
import type { InboxItem, TodoItem } from '@inbox-rs/rs-module';
import { get } from 'svelte/store';
import {
  CaldavError,
  deleteEntry,
  queryTasks,
  type RemoteTask,
  type SyncResult,
  syncCalendar,
  updateEntry,
} from './caldav';
import {
  accountEndpoint,
  type CalendarAccount,
  calendarAccounts,
  updateCalendarAccount,
} from './calendar-accounts';
import { clearPostedEntry, toDateInputValue } from './schedule';
import {
  flushItemChanges,
  items,
  restoreItem,
  restoring,
  storeItem,
  updateItem,
} from './stores';
import { showToast } from './toast';

const STATE_KEY = 'inbox-rs:task-sync';

interface Baseline {
  /** `fingerprint()` of the card as last synced. */
  fp: string;
  /** The server's copy, the base for updates. */
  remote: RemoteTask;
}

interface CalendarSyncState {
  token?: string;
  /** Keyed by task href. */
  entries: Record<string, Baseline>;
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
    console.error('Failed to persist task sync state', err);
  }
}

interface SyncTarget {
  account: CalendarAccount;
  calendarId: string;
  name: string;
}

function syncTargets(): SyncTarget[] {
  return get(calendarAccounts).flatMap((account) =>
    account.calendars
      .filter((c) => account.syncCalendarIds?.includes(c.id))
      .map((c) => ({ account, calendarId: c.id, name: c.name })),
  );
}

export function isCalendarSynced(calendarId: string): boolean {
  return syncTargets().some((t) => t.calendarId === calendarId);
}

/** Turn two-way task sync on or off for one calendar on this device. */
export function setCalendarSynced(
  account: CalendarAccount,
  calendarId: string,
  on: boolean,
): void {
  const ids = new Set(account.syncCalendarIds ?? []);
  if (on) ids.add(calendarId);
  else ids.delete(calendarId);
  updateCalendarAccount(account.id, { syncCalendarIds: [...ids] });
  if (on) {
    void runTaskSync();
  } else {
    const state = loadState();
    delete state[calendarId];
    saveState(state);
  }
}

// ---- Field mapping (exported for tests) ----

/** The task fields inbox-rs owns, from a card. Doubles as the fingerprint. */
export function taskFields(item: InboxItem): Record<string, unknown> {
  const due = item.startsAt
    ? item.allDay
      ? toDateInputValue(new Date(item.startsAt))
      : item.startsAt
    : undefined;
  return {
    name: item.title || 'Untitled',
    ...(item.description ? { content: item.description } : {}),
    ...(due ? { due } : {}),
    ...(due && item.allDay ? { allDay: true } : {}),
    status: item.completed ? 'completed' : 'needs-action',
    ...(item.completed
      ? { completedTime: item.completedAt ?? item.createdAt }
      : {}),
  };
}

const fingerprint = (item: InboxItem) => JSON.stringify(taskFields(item));

/** UTC ms for a wall-clock time in `zone`; the second pass settles DST edges. */
function zonedToUtc(local: string, zone: string): number {
  const wall = Date.parse(`${local.slice(0, 19)}Z`);
  const offset = (t: number) =>
    Date.parse(
      `${new Date(t).toLocaleString('sv-SE', { timeZone: zone }).replace(' ', 'T')}Z`,
    ) - t;
  return wall - offset(wall - offset(wall));
}

function parseDue(
  value: string,
  allDay: boolean,
  zone?: string,
): string | undefined {
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
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** A task's values as card fields (undefined clears the field). */
export function itemFieldsFromTask(task: RemoteTask): Partial<InboxItem> {
  // Servers report a DATE-valued DUE as a bare date, without `allDay`.
  const allDay = !!task.allDay || /^\d{4}-\d{2}-\d{2}$/.test(task.due ?? '');
  const startsAt = task.due
    ? parseDue(task.due, allDay, task.timeZone)
    : undefined;
  const completed = task.status === 'completed';
  return {
    title: task.name,
    description: task.content || undefined,
    isTodo: true,
    completed,
    completedAt: completed
      ? (task.completedTime ?? new Date().toISOString())
      : undefined,
    startsAt,
    endsAt: undefined,
    allDay: startsAt && allDay ? true : undefined,
    scheduleKind: startsAt ? 'task' : undefined,
  };
}

/** The server's copy with inbox-rs's fields laid over it, ready to PUT. */
export function taskUpdateObject(
  remote: RemoteTask,
  item: InboxItem,
): Record<string, unknown> {
  const {
    name: _name,
    content: _content,
    due: _due,
    allDay: _allDay,
    timeZone,
    status,
    completedTime: _completedTime,
    percentComplete,
    ...rest
  } = remote;
  const fields = taskFields(item);
  // Keep a richer open status (`in-process`) unless completion changed.
  if (fields.status === 'needs-action' && status && status !== 'completed') {
    fields.status = status;
  }
  // The platform rejects a zone on all-day values, and wants local
  // date-times when one is kept.
  const zone = fields.allDay ? undefined : timeZone;
  if (zone && typeof fields.due === 'string') {
    fields.due = new Date(fields.due)
      .toLocaleString('sv-SE', { timeZone: zone })
      .replace(' ', 'T');
  }
  return {
    ...rest,
    ...(zone ? { timeZone: zone } : {}),
    // A stale "50% done" would contradict a status we just changed.
    ...(percentComplete !== undefined && fields.status === status
      ? { percentComplete }
      : {}),
    ...fields,
    type: 'task',
    etag: item.eventEtag ?? remote.etag,
    sequence: (remote.sequence ?? 0) + 1,
  };
}

function isTask(entry: SyncResult['items'][number]): entry is RemoteTask {
  const e = entry as Partial<RemoteTask>;
  return (
    e.type === 'task' &&
    typeof e.id === 'string' &&
    typeof e.uid === 'string' &&
    typeof e.name === 'string'
  );
}

/** Pushing is off for tasks the platform can't rewrite without loss. */
function canPush(base: Baseline): boolean {
  // shortcut: recurring tasks are read-only here (completing one would end the series); edit them in the calendar app.
  return base.remote.updateSupported !== false && !base.remote.recurrence;
}

/**
 * The card for a task. Our own UIDs carry the item id; foreign tasks get an
 * id derived from their href, so a re-import (fresh device, reset token)
 * lands on the same card instead of a duplicate.
 */
async function itemIdFor(task: RemoteTask): Promise<string> {
  if (task.uid.endsWith('@inbox-rs')) return task.uid.slice(0, -9);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(task.id),
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

// ---- The pass ----

interface Changes {
  items: SyncResult['items'];
  removed: string[];
  /** A full snapshot: anything synced before and absent now was removed. */
  full: boolean;
  token?: string;
}

async function fetchChanges(
  target: SyncTarget,
  cal: CalendarSyncState,
): Promise<Changes> {
  const endpoint = accountEndpoint(target.account);
  const changes: Changes = { items: [], removed: [], full: !cal.token };
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
    if (err.code === 'caldav:sync-token-invalid' && cal.token) {
      cal.token = undefined;
      return fetchChanges(target, cal);
    }
    if (err.code !== 'caldav:sync-unsupported') throw err;
    const snapshot = await queryTasks(
      target.account,
      target.calendarId,
      endpoint,
    );
    return { items: snapshot.items, removed: [], full: true };
  }
  changes.token = token;
  return changes;
}

async function applyRemote(
  task: RemoteTask,
  cal: CalendarSyncState,
  byHref: Map<string, InboxItem>,
): Promise<void> {
  const base = cal.entries[task.id];
  const id = await itemIdFor(task);
  const item = byHref.get(task.id) ?? get(items)[id];
  if (!item) {
    // Finished tasks are history; only open ones are worth a new card.
    if (task.status === 'completed') return;
    const created = {
      id,
      type: 'todo',
      createdAt: new Date().toISOString(),
      ...itemFieldsFromTask(task),
      completed: false,
      eventUrl: task.id,
      eventEtag: task.etag,
    } as TodoItem;
    await storeItem(created);
    cal.entries[task.id] = { fp: fingerprint(created), remote: task };
    return;
  }
  if (
    base &&
    item.eventUrl === task.id &&
    item.eventEtag === task.etag &&
    task.etag
  ) {
    // Unchanged on the server: refresh the copy, keep any pending local edit.
    cal.entries[task.id] = { fp: base.fp, remote: task };
    return;
  }
  const localEdit = !!base && fingerprint(item) !== base.fp;
  const next = await updateItem(item.id, (current) =>
    current
      ? ({
          ...current,
          ...itemFieldsFromTask(task),
          eventUrl: task.id,
          eventEtag: task.etag,
          // A synced calendar shares the task; it no longer owns it.
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
  cal.entries[task.id] = { fp: fingerprint(next), remote: task };
  if (!localEdit) return;
  // The link fields match `next`, so Undo restores only the user's edit.
  const before = {
    ...item,
    eventUrl: next.eventUrl,
    eventEtag: next.eventEtag,
  };
  showToast(
    `“${task.name}” changed in your calendar app too — kept that version`,
    {
      label: 'Undo',
      run: () => void restoreItem({ before, after: next }),
    },
  );
}

async function pull(target: SyncTarget, cal: CalendarSyncState) {
  const changes = await fetchChanges(target, cal);
  const byHref = hrefIndex();
  for (const entry of changes.items) {
    if (isTask(entry)) await applyRemote(entry, cal, byHref);
  }
  const seen = new Set(changes.items.map((entry) => entry.id));
  const removed = changes.full
    ? Object.keys(cal.entries).filter((href) => !seen.has(href))
    : changes.removed;
  for (const href of removed) {
    if (!cal.entries[href]) continue;
    delete cal.entries[href];
    const item = byHref.get(href);
    if (item) {
      await updateItem(item.id, (current) =>
        current?.eventUrl === href ? clearPostedEntry(current) : null,
      );
    }
  }
  cal.token = changes.token;
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
    if (!item || !canPush(base) || fingerprint(item) === base.fp) continue;
    // No ETag means no conflict check; wait for a pull to supply one.
    if (!item.eventEtag && !base.remote.etag) continue;
    const object = taskUpdateObject(base.remote, item);
    try {
      const { eventEtag } = await updateEntry(
        target.account,
        target.calendarId,
        object,
        accountEndpoint(target.account),
      );
      cal.entries[href] = {
        fp: fingerprint(item),
        remote: { ...base.remote, ...object, etag: eventEtag } as RemoteTask,
      };
      await updateItem(item.id, (current) =>
        current?.eventUrl === href ? { ...current, eventEtag } : null,
      );
    } catch (err) {
      if (err instanceof CaldavError && err.code === 'caldav:conflict') {
        conflict = true;
      } else {
        console.error('Failed to push task to calendar', err);
      }
    }
  }
  return conflict;
}

let lastRun = 0;

async function syncAll(): Promise<void> {
  if (get(restoring)) return;
  lastRun = Date.now();
  flushItemChanges();
  const state = loadState();
  const targets = syncTargets();
  for (const id of Object.keys(state)) {
    if (!targets.some((t) => t.calendarId === id)) delete state[id];
  }
  for (const target of targets) {
    state[target.calendarId] ??= { entries: {} };
    const cal = state[target.calendarId];
    try {
      await pull(target, cal);
      if (await push(target, cal)) await pull(target, cal);
    } catch (err) {
      console.error('Task sync failed', err);
      if (
        !(err instanceof CaldavError && err.code === 'caldav:relay-unreachable')
      ) {
        showToast(
          `Couldn’t sync ${target.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
    } finally {
      saveState(state);
    }
  }
}

let running: Promise<void> | null = null;
let again = false;

/** Run a sync pass now; a call during a pass queues one more after it. */
export function runTaskSync(): Promise<void> {
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

function hasPendingPush(): boolean {
  const byHref = hrefIndex();
  return Object.values(loadState()).some((cal) =>
    Object.entries(cal.entries).some(([href, base]) => {
      const item = byHref.get(href);
      return !!item && canPush(base) && fingerprint(item) !== base.fp;
    }),
  );
}

/**
 * Card deleted in the app: delete its task too, when the task is synced.
 * Called from stores.deleteItem — only an explicit delete reaches here, so
 * a card merely missing locally (e.g. storage not loaded yet) never does.
 */
export async function deleteSyncedTask(item: InboxItem): Promise<void> {
  const href = item.eventUrl;
  if (!href) return;
  const state = loadState();
  for (const [calendarId, cal] of Object.entries(state)) {
    const base = cal.entries[href];
    if (!base) continue;
    delete cal.entries[href];
    saveState(state);
    const target = syncTargets().find((t) => t.calendarId === calendarId);
    const etag = item.eventEtag ?? base.remote.etag;
    // Deleting a recurring task's resource would take the whole series.
    if (!target || !etag || !canPush(base)) return;
    try {
      await deleteEntry(
        target.account,
        calendarId,
        { id: href, type: 'task', etag },
        accountEndpoint(target.account),
      );
    } catch (err) {
      console.error('Failed to delete synced task', err);
      showToast(`Couldn’t remove “${item.title}” from ${target.name}`);
    }
    return;
  }
}

let started = false;

/** Sync on load, when the app comes back into view, and after local edits. */
export function initTaskSync(): void {
  if (started) return;
  started = true;
  const kick = () => {
    if (syncTargets().length > 0) void runTaskSync();
  };
  restoring.subscribe((value) => {
    if (!value) kick();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRun > 60_000)
      kick();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  items.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (hasPendingPush()) kick();
    }, 2000);
  });
}
