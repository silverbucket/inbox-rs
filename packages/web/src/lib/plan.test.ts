import type { InboxItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import {
  applyPlan,
  choiceOf,
  clearPlan,
  fromDateKey,
  monthGrid,
  monthStart,
  moveItemToDay,
  moveToDay,
  placeTodo,
  planFor,
  planLabel,
  scheduledDayKey,
  shiftMonth,
  toDateKey,
  weekStart,
} from './plan';

// Wednesday, November 4, 2026, mid-morning local time.
const NOW = new Date(2026, 10, 4, 10, 30);

const todo = (extra: Partial<InboxItem> = {}): InboxItem =>
  ({
    id: 't1',
    type: 'todo',
    title: 'Something',
    completed: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  }) as InboxItem;

describe('date helpers', () => {
  it('weeks start on Monday', () => {
    expect(toDateKey(weekStart(NOW))).toBe('2026-11-02');
    // Sunday belongs to the week that started the previous Monday.
    expect(toDateKey(weekStart(new Date(2026, 10, 8, 23)))).toBe('2026-11-02');
    expect(toDateKey(weekStart(new Date(2026, 10, 9, 0, 1)))).toBe(
      '2026-11-09',
    );
  });

  it('months start on the 1st', () => {
    expect(toDateKey(monthStart(NOW))).toBe('2026-11-01');
  });

  it('round-trips date keys and rejects junk', () => {
    expect(toDateKey(fromDateKey('2026-12-01') as Date)).toBe('2026-12-01');
    expect(fromDateKey('12/01/2026')).toBeNull();
    expect(fromDateKey('2026-02-31')).toBeNull();
    expect(fromDateKey('2026-13-01')).toBeNull();
    expect(fromDateKey(undefined)).toBeNull();
  });
});

describe('planFor', () => {
  it('anchors weeks and months to their first day', () => {
    expect(planFor('next', NOW)).toEqual({ planKind: 'next' });
    expect(planFor('someday', NOW)).toEqual({ planKind: 'someday' });
    expect(planFor('week', NOW)).toEqual({
      planKind: 'week',
      planStart: '2026-11-02',
    });
    expect(planFor('nextWeek', NOW)).toEqual({
      planKind: 'week',
      planStart: '2026-11-09',
    });
    expect(planFor('month', NOW)).toEqual({
      planKind: 'month',
      planStart: '2026-11-01',
    });
    expect(planFor('nextMonth', NOW)).toEqual({
      planKind: 'month',
      planStart: '2026-12-01',
    });
  });

  it('crosses the year boundary', () => {
    const dec = new Date(2026, 11, 20);
    expect(planFor('nextMonth', dec).planStart).toBe('2027-01-01');
  });

  it('maps a stored plan back to the choice it was made from', () => {
    expect(choiceOf(planFor('nextWeek', NOW), NOW)).toBe('nextWeek');
    expect(
      choiceOf({ ...planFor('week', NOW), startsAt: NOW.toISOString() }, NOW),
    ).toBeNull();
    expect(choiceOf({}, NOW)).toBeNull();
  });
});

describe('placeTodo', () => {
  it('puts unplanned todos in "not planned yet"', () => {
    expect(placeTodo(todo(), NOW)).toEqual({ section: 'unplanned' });
  });

  it('treats a legacy pin as Up next', () => {
    expect(placeTodo(todo({ pinned: true }), NOW).section).toBe('next');
  });

  it('places soft plans in their horizon', () => {
    const at = (c: Parameters<typeof planFor>[0]) =>
      placeTodo(todo(planFor(c, NOW)), NOW).section;
    expect(at('next')).toBe('next');
    expect(at('week')).toBe('week');
    expect(at('nextWeek')).toBe('nextWeek');
    expect(at('month')).toBe('month');
    expect(at('nextMonth')).toBe('nextMonth');
    expect(at('someday')).toBe('someday');
  });

  it('moves plans forward as time passes, without rewriting them', () => {
    const nextWeek = todo(planFor('nextWeek', NOW));
    // A week later, "next week" is simply this week.
    expect(placeTodo(nextWeek, new Date(2026, 10, 10)).section).toBe('week');
    const nextMonth = todo(planFor('nextMonth', NOW));
    expect(placeTodo(nextMonth, new Date(2026, 11, 3)).section).toBe('month');
  });

  it('rolls an ended week into Up next with a tag', () => {
    const lastWeek = todo({ planKind: 'week', planStart: '2026-10-26' });
    expect(placeTodo(lastWeek, NOW)).toEqual({
      section: 'next',
      rolledFrom: 'from last week',
    });
    const older = placeTodo(
      todo({ planKind: 'week', planStart: '2026-10-12' }),
      NOW,
    );
    expect(older.section).toBe('next');
    expect(older.rolledFrom).toMatch(/^from week of /);
  });

  it('rolls an ended month into Up next with a tag', () => {
    const october = todo({ planKind: 'month', planStart: '2026-10-01' });
    const placed = placeTodo(october, NOW);
    expect(placed.section).toBe('next');
    expect(placed.rolledFrom).toMatch(/^from /);
  });

  it('places future dates by date and lets a date beat a plan', () => {
    const at = (
      y: number,
      m: number,
      d: number,
      extra: Partial<InboxItem> = {},
    ) =>
      placeTodo(
        todo({ startsAt: new Date(y, m, d, 9).toISOString(), ...extra }),
        NOW,
      ).section;
    expect(at(2026, 10, 6)).toBe('week');
    expect(at(2026, 10, 12)).toBe('nextWeek');
    expect(at(2026, 10, 25)).toBe('month');
    expect(at(2026, 11, 20)).toBe('nextMonth');
    expect(at(2027, 0, 14)).toBe('later');
    expect(at(2026, 10, 6, { planKind: 'someday' })).toBe('week');
  });

  it('survives malformed plan anchors', () => {
    expect(
      placeTodo(todo({ planKind: 'week', planStart: 'nope' }), NOW).section,
    ).toBe('next');
  });
});

describe('applyPlan / clearPlan / planLabel', () => {
  it('sets and clears plan fields without touching anything else', () => {
    const base = todo({ pinned: true });
    const planned = applyPlan(base, planFor('nextWeek', NOW));
    expect(planned.planKind).toBe('week');
    expect(planned.planStart).toBe('2026-11-09');
    expect(planned.pinned).toBe(true);
    const upNext = applyPlan(planned, planFor('next', NOW));
    expect('planStart' in upNext).toBe(false);
    const cleared = clearPlan(planned);
    expect('planKind' in cleared).toBe(false);
    expect('planStart' in cleared).toBe(false);
  });

  it('labels plans relative to today', () => {
    expect(planLabel(todo(planFor('nextWeek', NOW)), NOW)).toBe('Next week');
    expect(
      planLabel(todo(planFor('nextWeek', NOW)), new Date(2026, 10, 10)),
    ).toBe('This week');
    expect(planLabel(todo(), NOW)).toBe('');
  });
});

describe('calendar helpers', () => {
  it('covers a month in Monday-first weeks', () => {
    const weeks = monthGrid(new Date(2026, 10, 15));
    // November 2026 starts on a Sunday and ends on a Monday.
    expect(weeks).toHaveLength(6);
    expect(toDateKey(weeks[0][0])).toBe('2026-10-26');
    expect(toDateKey(weeks[0][6])).toBe('2026-11-01');
    expect(toDateKey(weeks[5][0])).toBe('2026-11-30');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('shifts months across years', () => {
    expect(toDateKey(shiftMonth(new Date(2026, 11, 20), 1))).toBe('2027-01-01');
    expect(toDateKey(shiftMonth(new Date(2026, 0, 31), -1))).toBe('2025-12-01');
  });

  it('keys items by their local scheduled day', () => {
    expect(
      scheduledDayKey({ startsAt: new Date(2026, 10, 6, 9).toISOString() }),
    ).toBe('2026-11-06');
    expect(scheduledDayKey({})).toBeNull();
  });

  it('moves undated or all-day items as all-day tasks, timed ones keep their time', () => {
    const day = new Date(2026, 10, 12);
    expect(moveToDay({}, day)).toEqual({
      kind: 'task',
      start: day,
      allDay: true,
    });
    const timed = moveToDay(
      {
        startsAt: new Date(2026, 10, 6, 14, 30).toISOString(),
        scheduleKind: 'event',
      },
      day,
    );
    expect(timed.allDay).toBe(false);
    expect(timed.kind).toBe('event');
    expect([
      timed.start.getDate(),
      timed.start.getHours(),
      timed.start.getMinutes(),
    ]).toEqual([12, 14, 30]);
  });

  it("keeps a timed event's duration when it moves", () => {
    const event = todo({
      startsAt: new Date(2026, 10, 6, 14, 0).toISOString(),
      endsAt: new Date(2026, 10, 6, 15, 30).toISOString(),
      scheduleKind: 'event',
    });
    const moved = moveItemToDay(event, new Date(2026, 10, 12));
    const start = new Date(moved.startsAt as string);
    const end = new Date(moved.endsAt as string);
    expect([start.getDate(), start.getHours(), start.getMinutes()]).toEqual([
      12, 14, 0,
    ]);
    expect((end.getTime() - start.getTime()) / 60_000).toBe(90);
  });

  it('shifts a multi-day all-day event by whole days', () => {
    const trip = todo({
      startsAt: new Date(2026, 10, 6).toISOString(),
      endsAt: new Date(2026, 10, 9).toISOString(),
      allDay: true,
      scheduleKind: 'event',
    });
    const moved = moveItemToDay(trip, new Date(2026, 10, 12));
    expect(moved.allDay).toBe(true);
    expect(new Date(moved.startsAt as string).getDate()).toBe(12);
    expect(new Date(moved.endsAt as string).getDate()).toBe(15);
  });

  it('gives an undated todo an all-day date with no end', () => {
    const moved = moveItemToDay(todo(), new Date(2026, 10, 12));
    expect(moved.allDay).toBe(true);
    expect(moved.scheduleKind).toBe('task');
    expect(moved.endsAt).toBeUndefined();
  });

  it('keeps an all-day end at local midnight across a clock change', () => {
    const tz = process.env.TZ;
    // Central Europe leaves summer time on Sunday, October 25 2026.
    process.env.TZ = 'Europe/Prague';
    try {
      // The trip itself spans the change (Oct 24 to 26); its new dates
      // (Oct 31 to Nov 2) don't, so elapsed-time shifting would land at 01:00.
      const trip = todo({
        startsAt: new Date(2026, 9, 24).toISOString(),
        endsAt: new Date(2026, 9, 26).toISOString(),
        allDay: true,
        scheduleKind: 'event',
      });
      const moved = moveItemToDay(trip, new Date(2026, 9, 31));
      const end = new Date(moved.endsAt as string);
      expect([
        end.getMonth(),
        end.getDate(),
        end.getHours(),
        end.getMinutes(),
      ]).toEqual([10, 2, 0, 0]);
    } finally {
      process.env.TZ = tz;
    }
  });
});
