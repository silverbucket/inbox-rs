import type { NoteItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import {
  applySchedule,
  clearSchedule,
  compareByDueTime,
  formatScheduled,
  fromInputValues,
  isDueTodayOrOverdue,
  isOverdue,
  isPast,
  nextRoundHour,
  quickOptions,
  toDateInputValue,
  toTimeInputValue,
} from './schedule';

// A local-time Wednesday afternoon.
const WED_1423 = new Date(2026, 6, 29, 14, 23);

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

describe('nextRoundHour', () => {
  it('rounds up to the next full hour', () => {
    expect(nextRoundHour(WED_1423).getHours()).toBe(15);
    expect(nextRoundHour(WED_1423).getMinutes()).toBe(0);
  });
});

describe('quickOptions', () => {
  it('offers tonight/tomorrow/saturday/next-week from a weekday afternoon', () => {
    const opts = quickOptions(WED_1423);
    expect(opts.map((o) => o.label)).toEqual([
      'Tonight 19:00',
      'Tomorrow 09:00',
      'Sat morning',
      'Next week',
    ]);
    const sat = opts[2].start;
    expect(sat.getDay()).toBe(6);
    expect(sat.getHours()).toBe(10);
    const mon = opts[3].start;
    expect(mon.getDay()).toBe(1);
    expect(mon.getTime()).toBeGreaterThan(WED_1423.getTime());
  });

  it('drops options already in the past', () => {
    const lateEvening = new Date(2026, 6, 29, 22, 0);
    expect(quickOptions(lateEvening).map((o) => o.label)).not.toContain(
      'Tonight 19:00',
    );
  });

  it('never suggests "Sat morning" meaning today', () => {
    const saturdayMorning = new Date(2026, 7, 1, 8, 0); // Sat Aug 1
    const sat = quickOptions(saturdayMorning).find(
      (o) => o.label === 'Sat morning',
    );
    expect(sat).toBeDefined();
    expect(sat!.start.getDate()).toBe(8); // the following Saturday
  });
});

describe('formatScheduled', () => {
  it('renders date and time, dropping the current year', () => {
    const item = note({ startsAt: new Date(2026, 6, 31, 9, 0).toISOString() });
    const label = formatScheduled(item, WED_1423);
    expect(label).toContain('Jul 31');
    expect(label).not.toContain('2026');
    expect(label).toContain('·');
  });

  it('renders date-only for all-day, with year when it differs', () => {
    const item = note({
      startsAt: new Date(2027, 0, 5).toISOString(),
      allDay: true,
    });
    const label = formatScheduled(item, WED_1423);
    expect(label).toContain('2027');
    expect(label).not.toContain('·');
  });

  it('is empty for unscheduled or malformed values', () => {
    expect(formatScheduled(note(), WED_1423)).toBe('');
    expect(formatScheduled(note({ startsAt: 'garbage' }), WED_1423)).toBe('');
  });
});

describe('isOverdue / isPast', () => {
  const past = new Date(2026, 6, 28, 9, 0).toISOString();
  it('marks pending past-due tasks overdue, but never events', () => {
    expect(
      isOverdue(note({ startsAt: past, scheduleKind: 'task' }), WED_1423),
    ).toBe(true);
    expect(
      isOverdue(
        note({ startsAt: past, scheduleKind: 'task', completed: true }),
        WED_1423,
      ),
    ).toBe(false);
    expect(
      isOverdue(note({ startsAt: past, scheduleKind: 'event' }), WED_1423),
    ).toBe(false);
  });

  it('all-day tasks are due end-of-day, not midnight', () => {
    const todayAllDay = note({
      startsAt: new Date(2026, 6, 29).toISOString(),
      allDay: true,
      scheduleKind: 'task',
    });
    expect(isOverdue(todayAllDay, WED_1423)).toBe(false);
  });

  it('isPast keys off the end for events with a duration', () => {
    const running = note({
      startsAt: new Date(2026, 6, 29, 14, 0).toISOString(),
      endsAt: new Date(2026, 6, 29, 15, 0).toISOString(),
    });
    expect(isPast(running, WED_1423)).toBe(false);
    expect(isPast(note({ startsAt: past }), WED_1423)).toBe(true);
  });
});

describe('isDueTodayOrOverdue / compareByDueTime', () => {
  // Local midnight of the reference Wednesday.
  const TODAY_START = new Date(2026, 6, 29).getTime();

  it('is date-based: earlier today, yesterday, and later today all count', () => {
    const laterToday = new Date(2026, 6, 29, 23, 0).toISOString();
    const yesterday = new Date(2026, 6, 28, 9, 0).toISOString();
    const tomorrow = new Date(2026, 6, 30, 0, 30).toISOString();
    expect(
      isDueTodayOrOverdue(note({ startsAt: laterToday }), TODAY_START),
    ).toBe(true);
    expect(
      isDueTodayOrOverdue(note({ startsAt: yesterday }), TODAY_START),
    ).toBe(true);
    expect(
      isDueTodayOrOverdue(note({ startsAt: tomorrow }), TODAY_START),
    ).toBe(false);
  });

  it('excludes completed, archived, and unscheduled items', () => {
    const due = new Date(2026, 6, 29, 9, 0).toISOString();
    expect(
      isDueTodayOrOverdue(
        note({ startsAt: due, completed: true }),
        TODAY_START,
      ),
    ).toBe(false);
    expect(
      isDueTodayOrOverdue(note({ startsAt: due, archived: true }), TODAY_START),
    ).toBe(false);
    expect(isDueTodayOrOverdue(note(), TODAY_START)).toBe(false);
  });

  it('compareByDueTime sorts earliest first, undated last', () => {
    const a = note({ startsAt: '2026-07-29T08:00:00.000Z' });
    const b = note({ startsAt: '2026-07-29T10:00:00.000Z' });
    const c = note();
    expect([b, c, a].sort(compareByDueTime).map((i) => i.startsAt)).toEqual([
      a.startsAt,
      b.startsAt,
      undefined,
    ]);
  });
});

describe('applySchedule / clearSchedule', () => {
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

  it('clearSchedule strips every scheduling field including the event ref', () => {
    const scheduled = applySchedule(
      note({ eventUrl: 'https://cal/x.ics', eventEtag: '"1"' }),
      { kind: 'event', start: new Date(), durationMin: 60 },
    );
    const cleared = clearSchedule(scheduled);
    for (const key of [
      'startsAt',
      'endsAt',
      'allDay',
      'scheduleKind',
      'eventUrl',
      'eventEtag',
    ] as const) {
      expect(cleared[key]).toBeUndefined();
    }
  });
});

describe('input value round-trip', () => {
  it('converts to and from date/time input strings in local time', () => {
    const d = new Date(2026, 6, 31, 9, 5);
    expect(toDateInputValue(d)).toBe('2026-07-31');
    expect(toTimeInputValue(d)).toBe('09:05');
    expect(fromInputValues('2026-07-31', '09:05')!.getTime()).toBe(d.getTime());
  });

  it('empty time means local midnight; invalid date is null', () => {
    const d = fromInputValues('2026-07-31', '')!;
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
    expect(fromInputValues('', '09:00')).toBeNull();
    expect(fromInputValues('2026-99-99', '')).toBeNull();
  });

  it('rejects out-of-range times instead of normalizing them', () => {
    expect(fromInputValues('2026-07-31', '12:60')).toBeNull();
    expect(fromInputValues('2026-07-31', '24:00')).toBeNull();
    expect(fromInputValues('2026-07-31', '23:59')).not.toBeNull();
  });
});
