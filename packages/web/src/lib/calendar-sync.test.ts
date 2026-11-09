// @vitest-environment jsdom
import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import type { writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  items: null as unknown,
  collections: null as unknown,
}));

vi.mock('./stores', async () => {
  const { writable: w, get } = await import('svelte/store');
  const items = w<Record<string, InboxItem>>({});
  const collections = w<Record<string, Collection>>({});
  h.items = items;
  h.collections = collections;
  const store = async (item: InboxItem) => {
    items.update((all) => ({ ...all, [item.id]: item }));
  };
  return {
    items,
    collections,
    restoring: w(false),
    flushItemChanges: () => {},
    storeItem: vi.fn(store),
    storeCollection: vi.fn(async (c: Collection) => {
      collections.update((all) => ({ ...all, [c.id]: c }));
    }),
    updateItem: vi.fn(async (id: string, fn: (c?: InboxItem) => InboxItem) => {
      const next = fn(get(items)[id]);
      if (next) await store(next);
      return next;
    }),
    restoreItem: vi.fn(async () => true),
  };
});
vi.mock('./toast', () => ({ showToast: vi.fn() }));
vi.mock('./caldav', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    syncCalendar: vi.fn(),
    currentSyncToken: vi.fn(async () => 't0'),
    queryEntries: vi.fn(async () => ({ items: [], removed: [] })),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(async () => {}),
  };
});

import { get } from 'svelte/store';
import {
  CaldavError,
  createEntry,
  currentSyncToken,
  deleteEntry,
  queryEntries,
  type RemoteEntry,
  syncCalendar,
  updateEntry,
} from './caldav';
import { calendarAccounts } from './calendar-accounts';
import {
  deleteSyncedEntry,
  entryIsCurrent,
  forgetEntry,
  itemFieldsFromEntry,
  keepInSync,
  linkCollection,
  previewLink,
  removeFromCalendar,
  runCalendarSync,
  stopSyncing,
  taskUpdateObject,
  unlinkCollection,
} from './calendar-sync';
import { clearSchedule } from './schedule';
import { restoreItem, storeCollection } from './stores';
import { showToast } from './toast';

const items = () =>
  h.items as ReturnType<typeof writable<Record<string, InboxItem>>>;
const cols = () =>
  h.collections as ReturnType<typeof writable<Record<string, Collection>>>;
const CAL = 'https://cal.example.org/nick/work/';
const CAL2 = 'https://cal.example.org/nick/home/';
const HREF = `${CAL}planify-1.ics`;

function remote(overrides: Partial<RemoteEntry> = {}): RemoteEntry {
  return {
    id: HREF,
    type: 'task',
    uid: 'planify-1',
    etag: '"1"',
    name: 'Pay rent',
    status: 'needs-action',
    due: '2099-11-12',
    allDay: true,
    reminders: [{ trigger: '-PT15M' }],
    updateSupported: true,
    ...overrides,
  };
}

function event(overrides: Partial<RemoteEntry> = {}): RemoteEntry {
  return {
    id: `${CAL}ev-1.ics`,
    type: 'event',
    uid: 'ev-1',
    etag: '"1"',
    name: 'Dentist',
    startTime: '2099-03-04T14:00:00Z',
    endTime: '2099-03-04T15:00:00Z',
    updateSupported: true,
    ...overrides,
  };
}

function page(changed: RemoteEntry[], removed: string[] = [], token = 't1') {
  return { items: changed, removed, syncToken: token, truncated: false };
}

const card = (href = HREF) => {
  const found = Object.values(get(items())).find((i) => i.eventUrl === href);
  if (!found) throw new Error('no synced card');
  return found;
};

const WORK: Collection = {
  id: 'work',
  name: 'Work',
  itemIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  calendar: { url: CAL, name: 'Work' },
};

const account = {
  id: 'acc1',
  label: 'Nextcloud',
  url: 'https://cal.example.org/',
  username: 'nick',
  password: 'pw',
  endpoint: 'https://relay.example.org/sockethub-http',
  calendars: [
    { id: CAL, name: 'Work', components: ['event' as const, 'task' as const] },
    { id: CAL2, name: 'Home', components: ['event' as const, 'task' as const] },
  ],
};

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  items().set({});
  cols().set({ work: WORK });
  calendarAccounts.set([account]);
  vi.mocked(currentSyncToken).mockResolvedValue('t0');
  vi.mocked(queryEntries).mockResolvedValue({ items: [], removed: [] });
  vi.mocked(syncCalendar).mockResolvedValue(page([]));
  // First pass: starts tracking from now.
  await runCalendarSync();
  vi.mocked(syncCalendar).mockClear();
  vi.mocked(currentSyncToken).mockClear();
});

describe('starting from today', () => {
  it('starts from the current token and never downloads history', async () => {
    localStorage.clear();
    await runCalendarSync();
    expect(currentSyncToken).toHaveBeenCalled();
    // A token-less sync would return the whole calendar.
    for (const call of vi.mocked(syncCalendar).mock.calls) {
      expect(call[2]).toBeTruthy();
    }
  });

  it('restarts from now when the server drops the token, without losing the gap', async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(page([remote()], [], 't1'));
    await runCalendarSync();
    vi.mocked(syncCalendar).mockRejectedValueOnce(
      new CaldavError('caldav:sync-token-invalid'),
    );
    vi.mocked(currentSyncToken).mockResolvedValueOnce('t9');
    // Changed while the token was stale: only the snapshot can tell us.
    vi.mocked(queryEntries).mockImplementation(async (_a, _c, q) => ({
      items:
        q.type === 'task'
          ? [remote({ etag: '"5"', name: 'Renamed in gap' })]
          : [],
      removed: [],
    }));
    // The first recovery's snapshot fails: the stale token must survive so
    // the next pass recovers again instead of skipping the gap.
    vi.mocked(queryEntries).mockRejectedValueOnce(
      new CaldavError('caldav:connection-failed'),
    );
    await runCalendarSync();
    expect(card().title).toBe('Pay rent');
    vi.mocked(syncCalendar).mockRejectedValueOnce(
      new CaldavError('caldav:sync-token-invalid'),
    );
    vi.mocked(currentSyncToken).mockResolvedValueOnce('t9');
    await runCalendarSync();
    // The retry still sent the old token, not the unreconciled new one.
    expect(vi.mocked(syncCalendar).mock.calls.at(-1)?.[2]).toBe('t1');
    expect(card().title).toBe('Renamed in gap');
    vi.mocked(syncCalendar).mockClear();
    await runCalendarSync();
    expect(vi.mocked(syncCalendar).mock.calls[0][2]).toBe('t9');
  });

  it('leaves calendars with no linked collection and no synced cards alone', async () => {
    cols().set({});
    localStorage.clear();
    await runCalendarSync();
    expect(currentSyncToken).not.toHaveBeenCalled();
    expect(syncCalendar).not.toHaveBeenCalled();
  });
});

describe('pull', () => {
  it('imports open tasks into the linked collection, with their real dates', async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page([
        remote({ created: '2024-03-03T10:00:00Z' }),
        remote({ id: `${CAL}done.ics`, uid: 'done', status: 'completed' }),
        remote({ id: `${CAL}gone.ics`, uid: 'gone', status: 'cancelled' }),
      ]),
    );
    await runCalendarSync();
    expect(Object.keys(get(items()))).toHaveLength(1);
    expect(card()).toMatchObject({
      type: 'todo',
      title: 'Pay rent',
      collectionId: 'work',
      calendarSync: true,
      createdAt: '2024-03-03T10:00:00Z',
      calendarCreatedAt: '2024-03-03T10:00:00Z',
    });
    expect(card().importedAt).toBeTruthy();
    // Filed with one collection write.
    expect(storeCollection).toHaveBeenCalledTimes(1);
    expect(get(cols()).work.itemIds).toEqual([card().id]);
  });

  it('imports upcoming events and skips ones that already ended', async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page([
        event(),
        event({
          id: `${CAL}old.ics`,
          uid: 'old',
          startTime: '2019-01-01T10:00:00Z',
          endTime: '2019-01-01T11:00:00Z',
        }),
      ]),
    );
    await runCalendarSync();
    expect(Object.keys(get(items()))).toHaveLength(1);
    expect(card(`${CAL}ev-1.ics`)).toMatchObject({
      type: 'note',
      title: 'Dentist',
      scheduleKind: 'event',
      startsAt: '2099-03-04T14:00:00.000Z',
      endsAt: '2099-03-04T15:00:00.000Z',
    });
  });

  it('shows a repeating event once, on its next date', async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page([
        event({
          startTime: '2020-01-06T09:00:00Z',
          endTime: '2020-01-06T09:30:00Z',
          recurrence: { frequency: 'weekly' },
        }),
      ]),
    );
    await runCalendarSync();
    const next = new Date(card(`${CAL}ev-1.ics`).startsAt as string);
    expect(next.getTime()).toBeGreaterThan(Date.now() - 7 * 86_400_000);
    expect(next.getDay()).toBe(new Date('2020-01-06T09:00:00Z').getDay());
  });

  it('moves a repeating event to its next date as time passes, with no server change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
      vi.mocked(syncCalendar).mockResolvedValueOnce(
        page([
          event({
            startTime: '2020-01-06T09:00:00Z',
            endTime: '2020-01-06T09:30:00Z',
            recurrence: { frequency: 'weekly' },
          }),
        ]),
      );
      await runCalendarSync();
      const first = card(`${CAL}ev-1.ics`).startsAt as string;
      vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
      await runCalendarSync(); // empty sync response
      const later = card(`${CAL}ev-1.ics`).startsAt as string;
      expect(new Date(later).getTime() - new Date(first).getTime()).toBe(
        7 * 86_400_000,
      );
      expect(updateEntry).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still offers Undo when a local edit to an advanced repeating event meets a remote change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
      const series = (extra: Partial<RemoteEntry> = {}) =>
        event({
          startTime: '2020-01-06T09:00:00Z',
          endTime: '2020-01-06T09:30:00Z',
          recurrence: { frequency: 'weekly' },
          ...extra,
        });
      vi.mocked(syncCalendar).mockResolvedValueOnce(page([series()]));
      await runCalendarSync();
      const c = card(`${CAL}ev-1.ics`);
      items().update((all) => ({
        ...all,
        [c.id]: { ...c, title: 'My local title' },
      }));
      vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
      await runCalendarSync(); // advances the date while the local edit is pending
      vi.mocked(syncCalendar).mockResolvedValueOnce(
        page([series({ etag: '"2"', name: 'Renamed remotely' })]),
      );
      await runCalendarSync();
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('changed in Work too'),
        expect.objectContaining({ label: 'Undo' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies changes and unlinks entries removed in the calendar, keeping the card', async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(page([remote()], [], 't1'));
    await runCalendarSync();
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page([remote({ etag: '"2"', name: 'Pay rent today' })], [], 't2'),
    );
    await runCalendarSync();
    expect(vi.mocked(syncCalendar).mock.calls[1][2]).toBe('t1');
    expect(card().title).toBe('Pay rent today');
    const id = card().id;
    vi.mocked(syncCalendar).mockResolvedValueOnce(page([], [HREF], 't3'));
    await runCalendarSync();
    expect(get(items())[id]).toMatchObject({
      title: 'Pay rent today',
      calendarSync: false,
    });
    expect(get(items())[id].eventUrl).toBeUndefined();
    // …and the linked collection doesn't add it straight back.
    await runCalendarSync();
    expect(createEntry).not.toHaveBeenCalled();
  });

  it('never lets an entry claim an unrelated card by putting its id in the UID', async () => {
    items().update((all) => ({
      ...all,
      victim: {
        id: 'victim',
        type: 'todo',
        title: 'Private',
        createdAt: '2026-01-01T00:00:00Z',
        completed: false,
      } as InboxItem,
    }));
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page([
        remote({
          id: `${CAL}evil.ics`,
          uid: 'victim@inbox-rs',
          name: 'Hijacked',
        }),
      ]),
    );
    await runCalendarSync();
    expect(get(items()).victim).toMatchObject({ title: 'Private' });
    expect(get(items()).victim.eventUrl).toBeUndefined();
  });

  it('never lets a forged UID claim an imported card that was unlinked', async () => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${CAL}orig.ics`),
    );
    const hid = `caldav-${[...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    items().update((all) => ({
      ...all,
      [hid]: {
        id: hid,
        type: 'todo',
        title: 'Mine',
        createdAt: '2026-01-01T00:00:00Z',
        completed: false,
      } as InboxItem,
    }));
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page([
        remote({
          id: `${CAL}other.ics`,
          uid: `${hid}@inbox-rs`,
          name: 'Hijacked',
        }),
      ]),
    );
    await runCalendarSync();
    expect(get(items())[hid]).toMatchObject({ title: 'Mine' });
  });

  it('keeps a sent-once receipt when its entry is deleted in the calendar', async () => {
    items().update((all) => ({
      ...all,
      once: {
        id: 'once',
        type: 'todo',
        title: 'Sent',
        createdAt: '2026-01-01T00:00:00Z',
        completed: false,
        eventUrl: HREF,
        eventEtag: '"1"',
        calendarSync: false,
      } as InboxItem,
    }));
    vi.mocked(syncCalendar).mockResolvedValueOnce(page([], [HREF]));
    await runCalendarSync();
    expect(get(items()).once.eventUrl).toBe(HREF);
  });

  it('ignores new entries on a calendar no collection is linked to', async () => {
    items().set({
      t1: {
        id: 't1',
        type: 'todo',
        title: 'Mine',
        createdAt: '2026-01-01T00:00:00Z',
        completed: false,
        eventUrl: `${CAL2}t1@inbox-rs.ics`,
        eventEtag: '"1"',
        calendarSync: true,
      } as InboxItem,
    });
    await runCalendarSync(); // starts tracking CAL2 for that one card
    vi.mocked(syncCalendar).mockImplementation(async (_a, calendarId) =>
      calendarId === CAL2
        ? page([
            remote({ id: `${CAL2}other.ics`, uid: 'other', name: 'Not mine' }),
            remote({
              id: `${CAL2}t1@inbox-rs.ics`,
              uid: 't1@inbox-rs',
              etag: '"2"',
              name: 'Mine, renamed',
            }),
          ])
        : page([]),
    );
    await runCalendarSync();
    const all = Object.values(get(items()));
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('Mine, renamed');
  });

  it('in snapshot mode, a card deleted with its entry kept stays deleted', async () => {
    localStorage.clear();
    vi.mocked(currentSyncToken).mockRejectedValueOnce(
      new CaldavError('caldav:sync-unsupported'),
    );
    await runCalendarSync();
    vi.mocked(queryEntries).mockImplementation(async (_a, _c, q) => ({
      items: q.type === 'task' ? [remote()] : [],
      removed: [],
    }));
    await runCalendarSync();
    const c = card();
    forgetEntry(c);
    items().update((all) => {
      const next = { ...all };
      delete next[c.id];
      return next;
    });
    await runCalendarSync(); // same snapshot, entry unchanged
    expect(Object.values(get(items())).some((i) => i.eventUrl === HREF)).toBe(
      false,
    );
  });

  it('falls back to "today onward" queries when the server has no WebDAV Sync', async () => {
    localStorage.clear();
    vi.mocked(currentSyncToken).mockRejectedValueOnce(
      new CaldavError('caldav:sync-unsupported'),
    );
    await runCalendarSync();
    vi.mocked(queryEntries).mockImplementation(async (_a, _c, q) => ({
      items: q.type === 'task' ? [remote()] : [],
      removed: [],
    }));
    await runCalendarSync();
    expect(card().title).toBe('Pay rent');
    const eventQuery = vi
      .mocked(queryEntries)
      .mock.calls.find((c) => c[2].type === 'event');
    expect(eventQuery?.[2].startTime).toBeTruthy();
  });
});

describe('push and create', () => {
  beforeEach(async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(page([remote()]));
    await runCalendarSync();
  });

  it('writes a local edit back with the ETag, keeping fields we do not model', async () => {
    vi.mocked(updateEntry).mockResolvedValueOnce({
      eventUrl: HREF,
      eventEtag: '"2"',
    });
    items().update((all) => {
      const todo = card();
      return {
        ...all,
        [todo.id]: {
          ...todo,
          completed: true,
          completedAt: '2026-11-09T09:00:00.000Z',
        },
      };
    });
    await runCalendarSync();
    const sent = vi.mocked(updateEntry).mock.calls[0][2];
    expect(sent).toMatchObject({
      id: HREF,
      uid: 'planify-1',
      etag: '"1"',
      status: 'completed',
      completedTime: '2026-11-09T09:00:00.000Z',
      due: '2099-11-12',
      allDay: true,
      reminders: [{ trigger: '-PT15M' }],
      sequence: 1,
    });
    expect(card().eventEtag).toBe('"2"');
    await runCalendarSync();
    expect(updateEntry).toHaveBeenCalledTimes(1);
  });

  it('on a conflict keeps the calendar version and offers Undo', async () => {
    vi.mocked(updateEntry).mockRejectedValueOnce(
      new CaldavError('caldav:conflict'),
    );
    items().update((all) => {
      const todo = card();
      return { ...all, [todo.id]: { ...todo, title: 'Local title' } };
    });
    vi.mocked(syncCalendar)
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(
        page([remote({ etag: '"2"', name: 'Remote title' })]),
      );
    await runCalendarSync();
    expect(card().title).toBe('Remote title');
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('changed in Work too'),
      expect.objectContaining({ label: 'Undo' }),
    );
    const toast = vi.mocked(showToast).mock.calls.at(-1)?.[1] as {
      run: () => void;
    };
    toast.run();
    const { before, after } = vi.mocked(restoreItem).mock.calls[0][0];
    expect(before).toMatchObject({ title: 'Local title', eventEtag: '"2"' });
    expect(after).toMatchObject({ title: 'Remote title', eventEtag: '"2"' });
  });

  it('adds new todos in the linked collection to the calendar, but not ones kept off it', async () => {
    vi.mocked(createEntry).mockResolvedValue({
      eventUrl: `${CAL}new.ics`,
      eventEtag: '"1"',
    });
    items().update((all) => ({
      ...all,
      n1: {
        id: 'n1',
        type: 'todo',
        title: 'New',
        createdAt: '2026-01-01T00:00:00Z',
        completed: false,
        collectionId: 'work',
      } as InboxItem,
      n2: {
        id: 'n2',
        type: 'todo',
        title: 'Off',
        createdAt: '2026-01-01T00:00:00Z',
        completed: false,
        collectionId: 'work',
        calendarSync: false,
      } as InboxItem,
      n3: {
        id: 'n3',
        type: 'todo',
        title: 'Done',
        createdAt: '2026-01-01T00:00:00Z',
        completed: true,
        collectionId: 'work',
      } as InboxItem,
    }));
    await runCalendarSync();
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createEntry).mock.calls[0][4]).toBe('task');
    expect(get(items()).n1).toMatchObject({
      eventUrl: `${CAL}new.ics`,
      calendarSync: true,
    });
  });

  it('moves the entry when a synced card is filed under another calendar', async () => {
    cols().update((all) => ({
      ...all,
      home: {
        id: 'home',
        name: 'Home',
        itemIds: [],
        createdAt: '2026-01-01T00:00:00Z',
        calendar: { url: CAL2, name: 'Home' },
      },
    }));
    vi.mocked(createEntry).mockResolvedValueOnce({
      eventUrl: `${CAL2}moved.ics`,
      eventEtag: '"5"',
    });
    items().update((all) => ({
      ...all,
      [card().id]: { ...card(), collectionId: 'home' },
    }));
    const id = card().id;
    await runCalendarSync();
    expect(vi.mocked(createEntry).mock.calls[0][1]).toBe(CAL2);
    // Built from the server's copy: its reminders come along.
    const copy = vi.mocked(createEntry).mock.calls[0][5];
    expect(copy).toMatchObject({
      uid: `${id}@inbox-rs`,
      name: 'Pay rent',
      reminders: [{ trigger: '-PT15M' }],
    });
    expect(copy).not.toHaveProperty('id');
    expect(copy).not.toHaveProperty('etag');
    expect(deleteEntry).toHaveBeenCalledWith(
      expect.anything(),
      CAL,
      { id: HREF, type: 'task', etag: '"1"' },
      expect.any(String),
    );
    expect(card(`${CAL2}moved.ics`).calendarSync).toBe(true);
  });

  it('retries removing the old entry when the move could not delete it', async () => {
    cols().update((all) => ({
      ...all,
      home: {
        id: 'home',
        name: 'Home',
        itemIds: [],
        createdAt: '2026-01-01T00:00:00Z',
        calendar: { url: CAL2, name: 'Home' },
      },
    }));
    vi.mocked(createEntry).mockResolvedValueOnce({
      eventUrl: `${CAL2}moved.ics`,
      eventEtag: '"5"',
    });
    vi.mocked(deleteEntry).mockRejectedValueOnce(
      new CaldavError('caldav:connection-failed'),
    );
    items().update((all) => ({
      ...all,
      [card().id]: { ...card(), collectionId: 'home' },
    }));
    await runCalendarSync();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('will retry'),
    );
    vi.mocked(deleteEntry).mockClear();
    await runCalendarSync();
    expect(deleteEntry).toHaveBeenCalledWith(
      expect.anything(),
      CAL,
      { id: HREF, type: 'task', etag: '"1"' },
      expect.any(String),
    );
    vi.mocked(deleteEntry).mockClear();
    await runCalendarSync();
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(createEntry).toHaveBeenCalledTimes(1);
  });

  it("pushes a synced bookmark's new URL", async () => {
    vi.mocked(createEntry).mockResolvedValueOnce({
      eventUrl: `${CAL}b1.ics`,
      eventEtag: '"1"',
    });
    vi.mocked(updateEntry).mockResolvedValueOnce({
      eventUrl: `${CAL}b1.ics`,
      eventEtag: '"2"',
    });
    items().update((all) => ({
      ...all,
      b1: {
        id: 'b1',
        type: 'bookmark',
        title: 'Docs',
        url: 'https://old.example.org/',
        createdAt: '2026-01-01T00:00:00Z',
        collectionId: 'work',
        startsAt: '2099-03-04T14:00:00.000Z',
      } as InboxItem,
    }));
    await runCalendarSync();
    expect(updateEntry).not.toHaveBeenCalled();
    items().update((all) => ({
      ...all,
      b1: { ...all.b1, url: 'https://new.example.org/' } as InboxItem,
    }));
    await runCalendarSync();
    expect(vi.mocked(updateEntry).mock.calls[0][2]).toMatchObject({
      url: 'https://new.example.org/',
    });
  });

  it('keeps an edit made while the entry was being created as a pending push', async () => {
    vi.mocked(createEntry).mockImplementationOnce(async () => {
      // The user renames the card while the create is in flight.
      items().update((all) => ({
        ...all,
        n1: { ...all.n1, title: 'Renamed' },
      }));
      return { eventUrl: `${CAL}n1.ics`, eventEtag: '"1"' };
    });
    vi.mocked(updateEntry).mockResolvedValue({
      eventUrl: `${CAL}n1.ics`,
      eventEtag: '"2"',
    });
    items().update((all) => ({
      ...all,
      n1: {
        id: 'n1',
        type: 'todo',
        title: 'New',
        createdAt: '2026-01-01T00:00:00Z',
        completed: false,
        collectionId: 'work',
      } as InboxItem,
    }));
    await runCalendarSync();
    expect(updateEntry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateEntry).mock.calls[0][2]).toMatchObject({
      name: 'Renamed',
    });
  });

  it('does not move an entry before this device has fetched it', async () => {
    cols().update((all) => ({
      ...all,
      home: {
        id: 'home',
        name: 'Home',
        itemIds: [],
        createdAt: '2026-01-01T00:00:00Z',
        calendar: { url: CAL2, name: 'Home' },
      },
    }));
    // A card synced elsewhere, never pulled on this device (no baseline).
    items().update((all) => ({
      ...all,
      r1: {
        id: 'r1',
        type: 'note',
        body: '',
        title: 'Series',
        createdAt: '2026-01-01T00:00:00Z',
        startsAt: '2099-01-01T09:00:00Z',
        scheduleKind: 'event',
        eventUrl: `${CAL}series.ics`,
        eventEtag: '"1"',
        calendarSync: true,
        collectionId: 'home',
      } as InboxItem,
    }));
    await runCalendarSync();
    expect(createEntry).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it('never pushes an entry that has attendees', async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page([remote({ etag: '"2"', attendees: [{ email: 'a@example.org' }] })]),
    );
    await runCalendarSync();
    items().update((all) => ({
      ...all,
      [card().id]: { ...card(), title: 'Edited' },
    }));
    await runCalendarSync();
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('stop syncing keeps the entry and the receipt, and stops pushing', async () => {
    await stopSyncing(card());
    expect(card()).toMatchObject({ calendarSync: false, eventUrl: HREF });
    items().update((all) => ({
      ...all,
      [card().id]: { ...card(), title: 'Edited' },
    }));
    await runCalendarSync();
    expect(updateEntry).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it('deleting the card deletes its entry', async () => {
    await deleteSyncedEntry(card());
    expect(deleteEntry).toHaveBeenCalledWith(
      expect.anything(),
      CAL,
      { id: HREF, type: 'task', etag: '"1"' },
      expect.any(String),
    );
  });

  it('keeps tracking an entry whose removal the server rejected', async () => {
    vi.mocked(deleteEntry).mockRejectedValueOnce(
      new CaldavError('caldav:connection-failed'),
    );
    await expect(removeFromCalendar(card())).rejects.toThrow();
    vi.mocked(updateEntry).mockResolvedValueOnce({
      eventUrl: HREF,
      eventEtag: '"2"',
    });
    items().update((all) => ({
      ...all,
      [card().id]: { ...card(), title: 'Still synced' },
    }));
    await runCalendarSync();
    expect(updateEntry).toHaveBeenCalledTimes(1);
  });

  it('looks up a past entry it never fetched before deleting it, and refuses repeating ones', async () => {
    const past = (extra: Partial<InboxItem>) =>
      ({
        id: 'p1',
        type: 'note',
        body: '',
        title: 'Old',
        createdAt: '2026-01-01T00:00:00Z',
        startsAt: '2026-01-05T09:00:00Z',
        scheduleKind: 'event',
        eventUrl: `${CAL}old.ics`,
        eventEtag: '"3"',
        calendarSync: true,
        collectionId: 'work',
        ...extra,
      }) as InboxItem;
    vi.mocked(queryEntries).mockResolvedValueOnce({
      items: [
        event({
          id: `${CAL}old.ics`,
          uid: 'old',
          startTime: '2026-01-05T09:00:00Z',
          endTime: '2026-01-05T10:00:00Z',
        }),
      ],
      removed: [],
    });
    await removeFromCalendar(past({}));
    expect(vi.mocked(queryEntries).mock.calls.at(-1)?.[2]).toMatchObject({
      type: 'event',
      endTime: expect.any(String),
    });
    expect(deleteEntry).toHaveBeenCalledWith(
      expect.anything(),
      CAL,
      { id: `${CAL}old.ics`, type: 'event', etag: '"3"' },
      expect.any(String),
    );
    vi.mocked(deleteEntry).mockClear();
    vi.mocked(queryEntries).mockResolvedValueOnce({
      items: [
        event({
          id: `${CAL}old.ics`,
          uid: 'old',
          recurrence: { frequency: 'weekly' },
        }),
      ],
      removed: [],
    });
    await expect(removeFromCalendar(past({}))).rejects.toThrow(/calendar app/);
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it('refuses a manual move for a card its collection link now governs', async () => {
    const choice = { account, calendar: account.calendars[1] };
    await expect(keepInSync(card(), choice)).rejects.toThrow(
      /follows its collection/,
    );
    expect(createEntry).not.toHaveBeenCalled();
  });

  it('no pass adds cards to a calendar while its collection is being unlinked', async () => {
    let release!: () => void;
    vi.mocked(storeCollection).mockImplementationOnce(
      (c: Collection) =>
        new Promise<void>((resolve) => {
          release = () => {
            cols().update((all) => ({ ...all, [c.id]: c }));
            resolve();
          };
        }),
    );
    items().update((all) => ({
      ...all,
      n9: {
        id: 'n9',
        type: 'todo',
        title: 'New',
        createdAt: '2026-01-01T00:00:00Z',
        completed: false,
        collectionId: 'work',
      } as InboxItem,
    }));
    const unlink = unlinkCollection(get(cols()).work);
    await Promise.resolve();
    const pass = runCalendarSync();
    // Hold the collection write long enough for a pass to reach creation.
    await new Promise((r) => setTimeout(r, 20));
    release();
    await unlink;
    await pass;
    expect(createEntry).not.toHaveBeenCalled();
  });

  it('unlinking keeps cards filed into the collection meanwhile', async () => {
    cols().update((all) => ({
      ...all,
      work: { ...all.work, itemIds: ['late'] },
    }));
    await unlinkCollection(WORK); // a stale copy with no itemIds
    expect(get(cols()).work.itemIds).toEqual(['late']);
    expect(get(cols()).work.calendar).toBeUndefined();
  });

  it('never deletes a repeating entry from the server', async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page([remote({ etag: '"2"', recurrence: { frequency: 'weekly' } })]),
    );
    await runCalendarSync();
    await deleteSyncedEntry(card());
    expect(deleteEntry).not.toHaveBeenCalled();
  });
});

describe('linking', () => {
  it('previews today onward, then imports only what was chosen', async () => {
    cols().set({
      inbox2: {
        id: 'inbox2',
        name: 'Planning',
        itemIds: [],
        createdAt: '2026-01-01T00:00:00Z',
      },
    });
    items().set({
      own: {
        id: 'own',
        type: 'todo',
        title: 'Existing todo',
        createdAt: '2026-01-01T00:00:00Z',
        completed: false,
        collectionId: 'inbox2',
      } as InboxItem,
    });
    vi.mocked(queryEntries).mockImplementation(async (_a, _c, q) => ({
      items:
        q.type === 'task'
          ? [
              remote(),
              remote({ id: `${CAL}b.ics`, uid: 'b', name: 'Skip me' }),
              remote({ id: `${CAL}c.ics`, uid: 'c', status: 'completed' }),
            ]
          : [event()],
      removed: [],
    }));
    const preview = await previewLink({
      account,
      calendar: account.calendars[0],
    });
    expect(preview.token).toBe('t0');
    expect(preview.tasks.map((t) => t.name)).toEqual(['Pay rent', 'Skip me']);
    expect(preview.events).toHaveLength(1);
    const eventQuery = vi
      .mocked(queryEntries)
      .mock.calls.find((c) => c[2].type === 'event');
    expect(eventQuery?.[2].startTime).toBeTruthy();

    await linkCollection(get(cols()).inbox2, preview, {
      importIds: new Set([HREF, `${CAL}ev-1.ics`]),
      addExisting: false,
    });
    expect(get(cols()).inbox2.calendar).toMatchObject({
      url: CAL,
      name: 'Work',
    });
    const titles = Object.values(get(items()))
      .map((i) => i.title)
      .sort();
    expect(titles).toEqual(['Dentist', 'Existing todo', 'Pay rent']);
    expect(get(items()).own.calendarSync).toBe(false);
  });
});

describe('field mapping', () => {
  it('sends instants when the entry has a zone Intl does not know', () => {
    const item = {
      id: 'x',
      type: 'note',
      title: 'Dentist',
      body: '',
      createdAt: '2026-11-01T00:00:00Z',
      startsAt: '2099-03-04T14:00:00.000Z',
    } as InboxItem;
    const sent = taskUpdateObject(event({ timeZone: 'Not/AZone' }), item);
    expect(sent.startTime).toBe('2099-03-04T14:00:00.000Z');
    expect(sent).not.toHaveProperty('timeZone');
  });

  it("keeps a foreign entry's own link when the card has none", () => {
    const item = {
      id: 'x',
      type: 'todo',
      title: 'Renamed',
      createdAt: '2026-11-01T00:00:00Z',
      completed: false,
    } as InboxItem;
    const sent = taskUpdateObject(
      remote({ url: 'https://planify.example/task/1' }),
      item,
    );
    expect(sent.url).toBe('https://planify.example/task/1');
  });

  it("keeps a moved foreign entry's link through a later rename", () => {
    // After a move the copy carries our UID, but the link is still the calendar's.
    const item = {
      id: 'x',
      type: 'note',
      title: 'Renamed',
      body: '',
      createdAt: '2026-11-01T00:00:00Z',
      startsAt: '2099-03-04T14:00:00.000Z',
    } as InboxItem;
    const sent = taskUpdateObject(
      event({ uid: 'x@inbox-rs', url: 'https://planify.example/ev/1' }),
      item,
    );
    expect(sent.url).toBe('https://planify.example/ev/1');
  });

  it('advances a zoned repeating event in its own zone, on a UTC device', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const fields = itemFieldsFromEntry(
        event({
          startTime: '2026-10-01T09:00:00',
          endTime: '2026-10-01T10:00:00',
          timeZone: 'Europe/Prague',
          recurrence: { frequency: 'weekly' },
        }),
        new Date('2026-10-27T12:00:00Z'),
      );
      // 09:00 CET after the Oct 25 DST change.
      expect(fields.startsAt).toBe('2026-10-29T08:00:00.000Z');
      expect(fields.endsAt).toBe('2026-10-29T09:00:00.000Z');
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('treats ended events as history and open tasks as current', () => {
    expect(entryIsCurrent(event())).toBe(true);
    expect(
      entryIsCurrent(
        event({
          startTime: '2019-01-01T10:00:00Z',
          endTime: '2019-01-01T11:00:00Z',
        }),
      ),
    ).toBe(false);
    expect(entryIsCurrent(remote({ due: '2019-01-01' }))).toBe(true);
    expect(entryIsCurrent(remote({ status: 'cancelled' }))).toBe(false);
  });

  it('clearing a date keeps "not on a calendar"', () => {
    const off = {
      id: 'x',
      type: 'todo',
      title: 'T',
      createdAt: '',
      completed: false,
      startsAt: '2099-01-01T00:00:00Z',
      calendarSync: false,
    } as InboxItem;
    expect(clearSchedule(off).calendarSync).toBe(false);
  });

  it("clearing a synced task's time keeps its link, so the change syncs", () => {
    const task = {
      id: 'x',
      type: 'todo',
      title: 'T',
      createdAt: '',
      completed: false,
      scheduleKind: 'task',
      startsAt: '2099-01-01T00:00:00Z',
      eventUrl: HREF,
      calendarSync: true,
    } as InboxItem;
    expect(clearSchedule(task).eventUrl).toBe(HREF);
    expect(
      clearSchedule({ ...task, calendarSync: undefined }).eventUrl,
    ).toBeUndefined();
  });

  it('keeps an in-process status when only the title changed', () => {
    const item = {
      id: 'x',
      type: 'todo',
      title: 'Renamed',
      createdAt: '2026-11-01T00:00:00Z',
      completed: false,
    } as InboxItem;
    const sent = taskUpdateObject(
      remote({ status: 'in-process', percentComplete: 40 }),
      item,
    );
    expect(sent).toMatchObject({ status: 'in-process', percentComplete: 40 });
  });

  it('keeps a task zone by sending the due time as local wall time', () => {
    const item = {
      id: 'x',
      type: 'todo',
      title: 'Call',
      createdAt: '2026-11-01T00:00:00Z',
      completed: false,
      startsAt: '2026-11-12T08:00:00.000Z',
    } as InboxItem;
    const sent = taskUpdateObject(
      remote({
        due: '2026-11-12T10:00:00',
        allDay: false,
        timeZone: 'Europe/Prague',
      }),
      item,
    );
    expect(sent).toMatchObject({
      due: '2026-11-12T09:00:00',
      timeZone: 'Europe/Prague',
    });
    expect(sent.allDay).toBeUndefined();
  });

  it('reads a zoned due time in the task zone, not the device zone', async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page([
        remote({
          allDay: undefined,
          due: '2099-11-12T10:00:00',
          timeZone: 'Europe/Prague',
        }),
      ]),
    );
    await runCalendarSync();
    expect(card().startsAt).toBe('2099-11-12T09:00:00.000Z');
  });
});
