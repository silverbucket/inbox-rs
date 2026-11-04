import type { InboxItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import {
  applyPlan,
  choiceOf,
  clearPlan,
  fromDateKey,
  monthStart,
  placeTodo,
  planFor,
  planLabel,
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
