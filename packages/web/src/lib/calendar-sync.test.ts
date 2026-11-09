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
  linkCollection,
  previewLink,
  runCalendarSync,
  stopSyncing,
  taskUpdateObject,
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

  it('restarts from now when the server drops the token', async () => {
    vi.mocked(syncCalendar).mockRejectedValueOnce(
      new CaldavError('caldav:sync-token-invalid'),
    );
    vi.mocked(currentSyncToken).mockResolvedValueOnce('t9');
    await runCalendarSync();
    expect(currentSyncToken).toHaveBeenCalled();
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
    await runCalendarSync();
    expect(vi.mocked(createEntry).mock.calls[0][1]).toBe(CAL2);
    expect(deleteEntry).toHaveBeenCalledWith(
      expect.anything(),
      CAL,
      { id: HREF, type: 'task', etag: '"1"' },
      expect.any(String),
    );
    expect(card(`${CAL2}moved.ics`).calendarSync).toBe(true);
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
