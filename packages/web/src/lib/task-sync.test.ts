// @vitest-environment jsdom
import type { InboxItem } from '@inbox-rs/rs-module';
import type { writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ items: null as unknown }));

vi.mock('./stores', async () => {
  const { writable: w, get } = await import('svelte/store');
  const items = w<Record<string, InboxItem>>({});
  h.items = items;
  const store = async (item: InboxItem) => {
    items.update((all) => ({ ...all, [item.id]: item }));
  };
  return {
    items,
    restoring: w(false),
    flushItemChanges: () => {},
    storeItem: vi.fn(store),
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
    queryTasks: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(async () => {}),
  };
});

import { get } from 'svelte/store';
import {
  CaldavError,
  deleteEntry,
  queryTasks,
  type RemoteTask,
  syncCalendar,
  updateEntry,
} from './caldav';
import { calendarAccounts } from './calendar-accounts';
import {
  deleteSyncedTask,
  runTaskSync,
  setCalendarSynced,
  taskUpdateObject,
} from './task-sync';
import { showToast } from './toast';

const items = () =>
  h.items as ReturnType<typeof writable<Record<string, InboxItem>>>;
const CAL = 'https://cal.example.org/nick/tasks/';
const HREF = `${CAL}planify-1.ics`;

function remote(overrides: Partial<RemoteTask> = {}): RemoteTask {
  return {
    id: HREF,
    type: 'task',
    uid: 'planify-1',
    etag: '"1"',
    name: 'Pay rent',
    status: 'needs-action',
    due: '2026-11-12',
    allDay: true,
    reminders: [{ trigger: '-PT15M' }],
    updateSupported: true,
    ...overrides,
  };
}

function page(changed: RemoteTask[], removed: string[] = [], token = 't1') {
  return { items: changed, removed, syncToken: token, truncated: false };
}

const card = () => {
  const found = Object.values(get(items())).find((i) => i.eventUrl === HREF);
  if (!found) throw new Error('no synced card');
  return found;
};

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  items().set({});
  const account = {
    id: 'acc1',
    label: 'Nextcloud',
    url: 'https://cal.example.org/',
    username: 'nick',
    password: 'pw',
    endpoint: 'https://relay.example.org/sockethub-http',
    calendars: [{ id: CAL, name: 'Tasks', components: ['task' as const] }],
  };
  calendarAccounts.set([account]);
  vi.mocked(syncCalendar).mockResolvedValue(page([]));
  setCalendarSynced(account, CAL, true);
  await runTaskSync();
  vi.mocked(syncCalendar).mockClear();
});

describe('task sync — pull', () => {
  it('imports open tasks as todos and skips finished ones', async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page([
        remote(),
        remote({
          id: `${CAL}done.ics`,
          uid: 'done',
          status: 'completed',
          completedTime: '2026-11-01T10:00:00Z',
        }),
      ]),
    );
    await runTaskSync();
    expect(Object.keys(get(items()))).toHaveLength(1);
    const todo = card();
    expect(todo).toMatchObject({
      type: 'todo',
      title: 'Pay rent',
      completed: false,
      allDay: true,
      scheduleKind: 'task',
      eventEtag: '"1"',
    });
    expect(new Date(todo.startsAt as string).getDate()).toBe(12);
  });

  it('sends the stored token, applies changes, and unlinks removed tasks', async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(page([remote()], [], 't1'));
    await runTaskSync();
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page(
        [
          remote({
            etag: '"2"',
            name: 'Pay rent today',
            status: 'completed',
            completedTime: '2026-11-09T08:00:00Z',
          }),
        ],
        [],
        't2',
      ),
    );
    await runTaskSync();
    expect(vi.mocked(syncCalendar).mock.calls[1][2]).toBe('t1');
    expect(card()).toMatchObject({ title: 'Pay rent today', completed: true });
    expect(updateEntry).not.toHaveBeenCalled();

    const id = card().id;
    vi.mocked(syncCalendar).mockResolvedValueOnce(page([], [HREF], 't3'));
    await runTaskSync();
    expect(get(items())[id]).toMatchObject({ title: 'Pay rent today' });
    expect(get(items())[id].eventUrl).toBeUndefined();
  });

  it('reads a bare-date due as all-day on the local day', async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(
      page([remote({ allDay: undefined, due: '2026-11-12' })]),
    );
    await runTaskSync();
    const due = new Date(card().startsAt as string);
    expect(card().allDay).toBe(true);
    expect([due.getDate(), due.getHours()]).toEqual([12, 0]);
  });

  it('falls back to a full query when the server has no WebDAV Sync', async () => {
    vi.mocked(syncCalendar).mockRejectedValueOnce(
      new CaldavError('caldav:sync-unsupported'),
    );
    vi.mocked(queryTasks).mockResolvedValueOnce({
      items: [remote()],
      removed: [],
    });
    await runTaskSync();
    expect(card().title).toBe('Pay rent');
  });
});

describe('task sync — push', () => {
  beforeEach(async () => {
    vi.mocked(syncCalendar).mockResolvedValueOnce(page([remote()]));
    await runTaskSync();
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
    await runTaskSync();
    const sent = vi.mocked(updateEntry).mock.calls[0][2];
    expect(sent).toMatchObject({
      id: HREF,
      uid: 'planify-1',
      etag: '"1"',
      status: 'completed',
      completedTime: '2026-11-09T09:00:00.000Z',
      due: '2026-11-12',
      allDay: true,
      reminders: [{ trigger: '-PT15M' }],
      sequence: 1,
    });
    expect(card().eventEtag).toBe('"2"');

    // Already pushed: the next pass sends nothing.
    await runTaskSync();
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
    await runTaskSync();
    expect(card().title).toBe('Remote title');
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('changed in your calendar app too'),
      expect.objectContaining({ label: 'Undo' }),
    );
  });

  it('deleting the card deletes its task', async () => {
    await deleteSyncedTask(card());
    expect(deleteEntry).toHaveBeenCalledWith(
      expect.anything(),
      CAL,
      { id: HREF, type: 'task', etag: '"1"' },
      expect.any(String),
    );
  });
});

describe('taskUpdateObject', () => {
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
});
