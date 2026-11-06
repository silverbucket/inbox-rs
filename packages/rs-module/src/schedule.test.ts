import { describe, expect, it } from 'vitest';
import { applySchedule } from './schedule.js';
import type { NoteItem } from './types.js';

function note(overrides: Partial<NoteItem> = {}): NoteItem {
  return {
    id: 'n1',
    type: 'note',
    title: 'n',
    body: '',
    createdAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('applySchedule', () => {
  it('computes endsAt from duration for timed events', () => {
    const start = new Date(2026, 6, 31, 9, 0);
    const item = applySchedule(note(), {
      kind: 'event',
      start,
      durationMin: 90,
    });
    expect(item.startsAt).toBe(start.toISOString());
    expect(new Date(item.endsAt!).getTime() - start.getTime()).toBe(
      90 * 60_000,
    );
    expect(item.scheduleKind).toBe('event');
    expect(item.allDay).toBeUndefined();
  });

  it('normalizes all-day starts to local midnight and drops endsAt/duration', () => {
    const item = applySchedule(note(), {
      kind: 'event',
      start: new Date(2026, 6, 31, 9, 30),
      durationMin: 60,
      allDay: true,
    });
    const d = new Date(item.startsAt!);
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
    expect(item.endsAt).toBeUndefined();
    expect(item.allDay).toBe(true);
  });

  it('tasks never get endsAt; rescheduling preserves the posted event ref', () => {
    const scheduled = applySchedule(
      note({ eventUrl: 'https://cal/x.ics', eventEtag: '"1"' }),
      { kind: 'task', start: new Date(2026, 6, 31, 14, 0), durationMin: 60 },
    );
    expect(scheduled.endsAt).toBeUndefined();
    expect(scheduled.eventUrl).toBe('https://cal/x.ics');
    expect(scheduled.eventEtag).toBe('"1"');
  });
});

describe('applySchedule all-day end', () => {
  const note = () =>
    ({
      id: 'n1',
      type: 'note',
      title: 'T',
      body: '',
      createdAt: '2026-01-01T00:00:00Z',
    }) as NoteItem;

  it('stores an all-day end as its local midnight, only when after the start', () => {
    const span = applySchedule(note(), {
      kind: 'event',
      start: new Date(2026, 10, 9),
      end: new Date(2026, 10, 11, 15, 0),
      allDay: true,
    });
    expect(span.endsAt).toBe(new Date(2026, 10, 11).toISOString());
    const sameDay = applySchedule(note(), {
      kind: 'event',
      start: new Date(2026, 10, 9),
      end: new Date(2026, 10, 9),
      allDay: true,
    });
    expect(sameDay.endsAt).toBeUndefined();
    const timed = applySchedule(note(), {
      kind: 'event',
      start: new Date(2026, 10, 9, 9, 0),
      end: new Date(2026, 10, 11),
    });
    expect(timed.endsAt).toBeUndefined();
  });
});

describe('applySchedule cancelled', () => {
  const start = new Date(2026, 10, 9, 18, 0);
  it('clears cancelled when an event becomes a task, keeps it for events', () => {
    const cancelled = note({ cancelled: true, scheduleKind: 'event' });
    expect(
      applySchedule(cancelled, { kind: 'task', start }).cancelled,
    ).toBeUndefined();
    expect(applySchedule(cancelled, { kind: 'event', start }).cancelled).toBe(
      true,
    );
  });
});

describe('applySchedule location', () => {
  const base = {
    id: 'n1',
    type: 'note',
    title: 'T',
    body: '',
    createdAt: '2026-01-01T00:00:00Z',
    location: 'Old venue',
  } as NoteItem;
  const start = new Date(2026, 10, 9, 18, 0);

  it('keeps the current location when the input omits it', () => {
    expect(applySchedule(base, { kind: 'event', start }).location).toBe(
      'Old venue',
    );
  });

  it('sets, trims, and clears the location when given', () => {
    expect(
      applySchedule(base, { kind: 'event', start, location: '  Room 1 ' })
        .location,
    ).toBe('Room 1');
    expect(
      applySchedule(base, { kind: 'event', start, location: ' ' }).location,
    ).toBeUndefined();
  });
});
