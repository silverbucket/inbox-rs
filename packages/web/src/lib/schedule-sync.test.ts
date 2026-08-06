// @vitest-environment jsdom
import type { NoteItem, TodoItem } from '@inbox-rs/rs-module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./stores', () => ({ storeItem: vi.fn(async () => {}) }));
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

import { calendarAccounts } from './calendar-accounts';
import { deleteEntry } from './caldav';
import { addItemToCalendar, reEnableFromCalendar } from './schedule-sync';
import { storeItem } from './stores';

const CAL = {
  id: 'https://cal.example.org/nick/personal/',
  name: 'Personal',
  components: ['event', 'task'] as Array<'event' | 'task'>,
};

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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  calendarAccounts.set([
    {
      id: 'acc1',
      label: 'Fastmail',
      url: 'https://cal.example.org/',
      username: 'nick',
      password: 'pw',
      endpoint: 'https://relay.example.org/sockethub-http',
      calendars: [CAL],
    },
  ]);
});

function lastStored(): Record<string, unknown> {
  const calls = vi.mocked(storeItem).mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe('addItemToCalendar — the archive ownership rule', () => {
  it('archives an Inbox reference card on first post (move is the default)', async () => {
    const result = await addItemToCalendar(note(), CAL.id);
    expect(result.archived).toBe(true);
    expect(result.archivedAt).toBeTruthy();
    expect(lastStored().archived).toBe(true);
  });

  it('archives todos in move mode — the calendar owns them now', async () => {
    const todo: TodoItem = {
      id: 't1',
      type: 'todo',
      title: 't',
      completed: false,
      createdAt: '2026-07-01T00:00:00Z',
      startsAt: '2026-08-03T13:00:00.000Z',
      scheduleKind: 'task',
    };
    const result = await addItemToCalendar(todo, CAL.id, 'move');
    expect(result.archived).toBe(true);
    expect(result.archivedAt).toBeTruthy();
  });

  it('archives filed cards in move mode', async () => {
    const filed = note({ collectionId: 'col-1' });
    const result = await addItemToCalendar(filed, CAL.id);
    expect(result.archived).toBe(true);
  });

  it('never archives in copy mode — the item stays active in the app', async () => {
    const result = await addItemToCalendar(note(), CAL.id, 'copy');
    expect(result.archived).toBeUndefined();
    expect(result.archivedAt).toBeUndefined();
    expect(result.eventUrl).toBeTruthy();
  });

  it('does not re-archive on subsequent posts (calendar move keeps state)', async () => {
    const posted = note({
      eventUrl: `${CAL.id}x.ics`,
      eventEtag: '"e1"',
    });
    const result = await addItemToCalendar(posted, CAL.id);
    expect(result.archived).toBeUndefined();
  });
});

describe('reEnableFromCalendar', () => {
  it('un-archives locally, keeping the entry link and the time — the calendar is never touched', async () => {
    const archived = note({
      eventUrl: `${CAL.id}x.ics`,
      eventEtag: '"e1"',
      archived: true,
      archivedAt: '2026-08-01T00:00:00Z',
    });
    const result = await reEnableFromCalendar(archived);
    expect(result.archived).toBeUndefined();
    expect(result.archivedAt).toBeUndefined();
    // The link survives: the item is a copy now, still syncing to its entry.
    expect(result.eventUrl).toBe(archived.eventUrl);
    expect(result.eventEtag).toBe(archived.eventEtag);
    expect(result.startsAt).toBe(archived.startsAt);
    // No server call of any kind.
    expect(vi.mocked(deleteEntry)).not.toHaveBeenCalled();
  });
});
