// @vitest-environment jsdom
import type { BookmarkItem, NoteItem, TodoItem } from '@inbox-rs/rs-module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CaldavError,
  createEntry,
  deleteEntry,
  fetchCalendars,
  itemToCalendarObject,
  uidFor,
  updateEntry,
} from './caldav';
import { cardLink } from './route';

const ENDPOINT = 'https://sockethub.test/sockethub-http';
const CREDS = {
  url: 'https://cal.example.org/',
  username: 'nick',
  password: 'secret',
};

function note(overrides: Partial<NoteItem> = {}): NoteItem {
  return {
    id: 'item-1',
    type: 'note',
    title: 'Prepare demo',
    body: '',
    createdAt: '2026-07-01T00:00:00Z',
    startsAt: '2026-08-03T13:00:00.000Z',
    endsAt: '2026-08-03T14:00:00.000Z',
    scheduleKind: 'event',
    ...overrides,
  };
}

function ndjson(...lines: unknown[]): Response {
  return new Response(lines.map((l) => JSON.stringify(l)).join('\n'), {
    status: 200,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('itemToCalendarObject', () => {
  it('maps a timed event: name, instants, linkback url, bookmark url in notes, alarm', () => {
    const bookmark: BookmarkItem = {
      id: 'bm-1',
      type: 'bookmark',
      title: 'Read this',
      url: 'https://example.org/post',
      createdAt: '2026-07-01T00:00:00Z',
      startsAt: '2026-08-03T13:00:00.000Z',
      endsAt: '2026-08-03T14:00:00.000Z',
      scheduleKind: 'event',
      description: 'notes',
    };
    expect(itemToCalendarObject(bookmark)).toEqual({
      type: 'event',
      uid: 'bm-1@inbox-rs',
      name: 'Read this',
      content: 'notes\n\nhttps://example.org/post',
      url: cardLink('bm-1'),
      reminders: [{ trigger: 'PT0S', action: 'display' }],
      startTime: '2026-08-03T13:00:00.000Z',
      endTime: '2026-08-03T14:00:00.000Z',
    });
    expect(cardLink('bm-1')).toMatch(/#\/card\/bm-1$/);
  });

  it('maps all-day entries to local date-only strings without endTime', () => {
    // Local-midnight start, as applySchedule stores it.
    const start = new Date(2026, 7, 3);
    const obj = itemToCalendarObject(
      note({ startsAt: start.toISOString(), endsAt: undefined, allDay: true }),
    )!;
    expect(obj.allDay).toBe(true);
    expect(obj.startTime).toBe('2026-08-03');
    expect(obj.endTime).toBeUndefined();
    // All-day alarms ring at 09:00 local, like the in-app scheduler.
    expect(obj.reminders).toEqual([{ trigger: 'PT9H', action: 'display' }]);
  });

  it('maps tasks to due, with completed status + completedTime', () => {
    const todo: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'Call dentist',
      completed: true,
      completedAt: '2026-08-01T10:00:00Z',
      createdAt: '2026-07-01T00:00:00Z',
      startsAt: '2026-08-05T12:00:00.000Z',
      scheduleKind: 'task',
    };
    expect(itemToCalendarObject(todo)).toEqual({
      type: 'task',
      uid: 'todo-1@inbox-rs',
      name: 'Call dentist',
      url: cardLink('todo-1'),
      reminders: [{ trigger: 'PT0S', action: 'display' }],
      due: '2026-08-05T12:00:00.000Z',
      status: 'completed',
      completedTime: '2026-08-01T10:00:00Z',
    });
  });

  it('returns null for unscheduled items', () => {
    expect(itemToCalendarObject(note({ startsAt: undefined }))).toBeNull();
  });
});

describe('fetchCalendars', () => {
  it('sends [credentials, fetch] and returns calendar descriptors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ndjson(
        { type: 'credentials', actor: { id: 'x' } }, // ack line — skipped
        {
          type: 'collection',
          totalItems: 1,
          items: [
            {
              id: 'https://cal.example.org/nick/personal/',
              type: 'calendar',
              name: 'Personal',
              components: ['event', 'task'],
            },
          ],
        },
      ),
    );
    const calendars = await fetchCalendars(CREDS, ENDPOINT);
    expect(calendars).toHaveLength(1);
    expect(calendars[0].name).toBe('Personal');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toHaveLength(2);
    expect(body[0].type).toBe('credentials');
    expect(body[0].object.password).toBe('secret');
    expect(body[1].type).toBe('fetch');
    expect(body[1].actor.id).toBe('caldav://nick@cal.example.org');
    // fetch must carry no target/object per the platform's constraints
    expect(body[1].target).toBeUndefined();
    expect(body[1].object).toBeUndefined();
  });

  it('throws a coded CaldavError from an error line', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ndjson({ type: 'error', error: 'caldav:authentication-failed' }),
    );
    const err = await fetchCalendars(CREDS, ENDPOINT).catch((e) => e);
    expect(err).toBeInstanceOf(CaldavError);
    expect(err.code).toBe('caldav:authentication-failed');
    expect(err.message).toMatch(/app password/);
  });

  it('throws when the relay itself fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 503 }),
    );
    await expect(fetchCalendars(CREDS, ENDPOINT)).rejects.toThrow(/503/);
  });

  it('normalizes network/timeout failures into a coded CaldavError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    );
    const err = await fetchCalendars(CREDS, ENDPOINT).catch((e) => e);
    expect(err).toBeInstanceOf(CaldavError);
    expect(err.code).toBe('caldav:relay-unreachable');
  });

  it('drops discovered entries missing the RemoteCalendar shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ndjson({
        type: 'collection',
        totalItems: 3,
        items: [
          {
            id: 'https://cal/x/',
            type: 'calendar',
            name: 'OK',
            components: ['event'],
          },
          { id: 'https://cal/y/', type: 'calendar', name: 'No components' },
          { id: 'https://cal/z/', type: 'calendar', components: ['event'] },
        ],
      }),
    );
    const calendars = await fetchCalendars(CREDS, ENDPOINT);
    expect(calendars.map((c) => c.name)).toEqual(['OK']);
  });
});

describe('mutations', () => {
  const CAL = 'https://cal.example.org/nick/personal/';

  it('create targets the calendar and returns href + etag', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ndjson({
        type: 'create',
        actor: {},
        target: {},
        object: { id: `${CAL}item-1%40inbox-rs.ics`, etag: '"e1"' },
      }),
    );
    const posted = await createEntry(CREDS, CAL, note(), ENDPOINT);
    expect(posted).toEqual({
      eventUrl: `${CAL}item-1%40inbox-rs.ics`,
      eventEtag: '"e1"',
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body[1].target).toEqual({ id: CAL, type: 'calendar' });
    expect(body[1].object.uid).toBe(uidFor(note()));
  });

  it('update sends the full object with the entry id + etag', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ndjson({
        type: 'update',
        actor: {},
        target: {},
        object: { id: `${CAL}item-1%40inbox-rs.ics`, etag: '"e2"' },
      }),
    );
    const item = note({
      eventUrl: `${CAL}item-1%40inbox-rs.ics`,
      eventEtag: '"e1"',
    });
    const posted = await updateEntry(CREDS, CAL, item, ENDPOINT);
    expect(posted.eventEtag).toBe('"e2"');
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body[1].type).toBe('update');
    expect(body[1].object).toMatchObject({
      id: `${CAL}item-1%40inbox-rs.ics`,
      etag: '"e1"',
      uid: 'item-1@inbox-rs',
      name: 'Prepare demo',
    });
  });

  it('delete sends id, kind, and etag', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        ndjson({ type: 'delete', actor: {}, target: {}, object: {} }),
      );
    const item = note({
      scheduleKind: 'task',
      eventUrl: `${CAL}item-1%40inbox-rs.ics`,
      eventEtag: '"e1"',
    });
    await deleteEntry(CREDS, CAL, item, ENDPOINT);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body[1]).toMatchObject({
      type: 'delete',
      target: { id: CAL, type: 'calendar' },
      object: { id: `${CAL}item-1%40inbox-rs.ics`, type: 'task', etag: '"e1"' },
    });
  });

  it('delete surfaces a conflict as a coded error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ndjson({ error: 'caldav:conflict' }),
    );
    const item = note({ eventUrl: `${CAL}x.ics`, eventEtag: '"e1"' });
    await expect(deleteEntry(CREDS, CAL, item, ENDPOINT)).rejects.toMatchObject(
      {
        code: 'caldav:conflict',
      },
    );
  });
});
