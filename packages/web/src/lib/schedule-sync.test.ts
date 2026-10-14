// @vitest-environment jsdom
import type { NoteItem, TodoItem } from '@inbox-rs/rs-module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./stores', async () => {
  const { writable } = await import('svelte/store');
  return { storeItem: vi.fn(async () => {}), items: writable({}) };
});
vi.mock('./toast', () => ({ showToast: vi.fn() }));
vi.mock('./caldav', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createEntry: vi.fn(async () => ({
      eventUrl: 'https://cal.example.org/nick/personal/x.ics',
      eventEtag: '"e1"',
    })),
    updateEntry: vi.fn(async () => ({
      eventUrl: 'https://cal.example.org/nick/personal/x.ics',
      eventEtag: '"e2"',
    })),
    deleteEntry: vi.fn(async () => {}),
  };
});

import { CaldavError, createEntry, deleteEntry, updateEntry } from './caldav';
import { calendarAccounts, calendarSyncPrefs } from './calendar-accounts';
import {
  applyPendingSchedule,
  removeEntryForDeletedItem,
  setItemCalendar,
  setItemCompleted,
  syncEntry,
} from './schedule-sync';
import { storeItem } from './stores';
import { showToast } from './toast';

const PERSONAL = {
  id: 'https://cal.example.org/nick/personal/',
  name: 'Personal',
  components: ['event', 'task'] as Array<'event' | 'task'>,
};
const WORK = {
  id: 'https://cal.example.org/nick/work/',
  name: 'Work',
  components: ['event'] as Array<'event' | 'task'>,
};
const ENTRY = `${PERSONAL.id}x.ics`;

function note(overrides: Partial<NoteItem> = {}): NoteItem {
  return {
    id: 'n1',
    type: 'note',
    title: 'n',
    body: '',
    createdAt: '2026-07-01T00:00:00Z',
    startsAt: '2026-08-03T13:00:00.000Z',
    scheduleKind: 'event',
    ...overrides,
  };
}

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 't1',
    type: 'todo',
    title: 't',
    completed: false,
    createdAt: '2026-07-01T00:00:00Z',
    startsAt: '2026-08-03T13:00:00.000Z',
    scheduleKind: 'task',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  calendarSyncPrefs.set({ event: { auto: false }, task: { auto: false } });
  calendarAccounts.set([
    {
      id: 'acc1',
      label: 'Fastmail',
      url: 'https://cal.example.org/',
      username: 'nick',
      password: 'pw',
      endpoint: 'https://relay.example.org/sockethub-http',
      calendars: [PERSONAL, WORK],
    },
  ]);
});

function lastStored(): Record<string, unknown> {
  const calls = vi.mocked(storeItem).mock.calls;
  return calls[calls.length - 1][0] as unknown as Record<string, unknown>;
}

describe('setItemCalendar', () => {
  it('creates the entry and stores the pointer; the card is never archived', async () => {
    const posted = await setItemCalendar(note(), PERSONAL.id);
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(posted.eventUrl).toBe(ENTRY);
    expect(lastStored()).toMatchObject({ eventUrl: ENTRY, eventEtag: '"e1"' });
    expect(lastStored().archived).toBeUndefined();
  });

  it('remembers the chosen calendar as last-used for the kind', async () => {
    await setItemCalendar(note(), WORK.id);
    expect(localStorage.getItem('inbox-rs:last-calendar:event')).toBe(WORK.id);
  });

  it('moving between calendars is delete + create', async () => {
    const item = note({ eventUrl: ENTRY, eventEtag: '"e1"' });
    await setItemCalendar(item, WORK.id);
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createEntry).mock.calls[0][1]).toBe(WORK.id);
  });

  it('null takes the card off its calendar and clears the pointer', async () => {
    const item = note({ eventUrl: ENTRY, eventEtag: '"e1"' });
    const detached = await setItemCalendar(item, null);
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    expect(detached.eventUrl).toBeUndefined();
    expect(lastStored().eventUrl).toBeUndefined();
  });

  it('is a no-op when already on that calendar', async () => {
    const item = note({ eventUrl: ENTRY, eventEtag: '"e1"' });
    await setItemCalendar(item, PERSONAL.id);
    expect(createEntry).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('rejects an unknown calendar before touching anything', async () => {
    await expect(
      setItemCalendar(note(), 'https://nope/'),
    ).rejects.toBeInstanceOf(CaldavError);
    expect(storeItem).not.toHaveBeenCalled();
  });
});

describe('syncEntry', () => {
  it('updates the entry when a synced card changes', async () => {
    const prev = note({ eventUrl: ENTRY, eventEtag: '"e1"' });
    const next = { ...prev, startsAt: '2026-08-04T13:00:00.000Z' };
    const synced = await syncEntry(prev, next);
    expect(updateEntry).toHaveBeenCalledTimes(1);
    expect(synced.eventEtag).toBe('"e2"');
  });

  it('deletes the entry when the time is cleared', async () => {
    const prev = note({ eventUrl: ENTRY, eventEtag: '"e1"' });
    const next = { ...prev, startsAt: undefined };
    const synced = await syncEntry(prev, next);
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    expect(synced.eventUrl).toBeUndefined();
  });

  it('still drops the pointer when the delete fails, and says so', async () => {
    vi.mocked(deleteEntry).mockRejectedValueOnce(
      new CaldavError('caldav:relay-unreachable'),
    );
    const prev = note({ eventUrl: ENTRY, eventEtag: '"e1"' });
    const synced = await syncEntry(prev, { ...prev, startsAt: undefined });
    expect(synced.eventUrl).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(/entry stayed/),
    );
  });

  it('re-creates the entry when the kind flips (VEVENT ≠ VTODO)', async () => {
    const prev = note({ eventUrl: ENTRY, eventEtag: '"e1"' });
    const next = { ...prev, scheduleKind: 'task' as const };
    await syncEntry(prev, next);
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('auto-creates on the default calendar for a newly timed card', async () => {
    calendarSyncPrefs.set({
      event: { auto: true, calendarId: WORK.id },
      task: { auto: false },
    });
    const synced = await syncEntry(note({ startsAt: undefined }), note());
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createEntry).mock.calls[0][1]).toBe(WORK.id);
    expect(synced.eventUrl).toBe(ENTRY);
  });

  it('does nothing for a newly timed card when auto is off', async () => {
    const synced = await syncEntry(note({ startsAt: undefined }), note());
    expect(createEntry).not.toHaveBeenCalled();
    expect(synced).toEqual(note());
  });

  it('leaves the entry alone on conflict and tells the user', async () => {
    vi.mocked(updateEntry).mockRejectedValueOnce(
      new CaldavError('caldav:conflict'),
    );
    const prev = note({ eventUrl: ENTRY, eventEtag: '"e1"' });
    const synced = await syncEntry(prev, { ...prev, title: 'renamed' });
    expect(synced.eventEtag).toBe('"e1"');
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(/calendar app/),
    );
  });

  it('drops the pointer when the entry belongs to a removed account', async () => {
    const prev = note({
      eventUrl: 'https://gone.example/cal/x.ics',
      eventEtag: '"e1"',
    });
    const synced = await syncEntry(prev, prev);
    expect(synced.eventUrl).toBeUndefined();
    expect(deleteEntry).not.toHaveBeenCalled();
  });
});

describe('completion and capture', () => {
  it('setItemCompleted mirrors completion onto a synced task', async () => {
    await setItemCompleted(todo({ eventUrl: ENTRY, eventEtag: '"e1"' }), true);
    expect(updateEntry).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(updateEntry).mock.calls[0][2];
    expect(sent.completed).toBe(true);
  });

  it('setItemCompleted stays local for an unsynced todo', async () => {
    await setItemCompleted(todo(), true);
    expect(updateEntry).not.toHaveBeenCalled();
    expect(lastStored()).toMatchObject({ completed: true });
  });

  it('applyPendingSchedule auto-syncs a capture-time due date', async () => {
    calendarSyncPrefs.set({
      event: { auto: false },
      task: { auto: true, calendarId: PERSONAL.id },
    });
    await applyPendingSchedule(
      todo({ startsAt: undefined, scheduleKind: undefined }),
      {
        kind: 'task',
        start: new Date('2026-08-05T09:00:00Z'),
      },
    );
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(lastStored()).toMatchObject({ eventUrl: ENTRY });
  });

  it('removeEntryForDeletedItem deletes best-effort', async () => {
    await removeEntryForDeletedItem(
      note({ eventUrl: ENTRY, eventEtag: '"e1"' }),
    );
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    vi.mocked(deleteEntry).mockRejectedValueOnce(
      new CaldavError('caldav:relay-unreachable'),
    );
    await removeEntryForDeletedItem(
      note({ eventUrl: ENTRY, eventEtag: '"e1"' }),
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(/entry stayed/),
    );
  });
});
