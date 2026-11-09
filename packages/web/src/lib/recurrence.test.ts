import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextOccurrence } from './recurrence';

const local = (y: number, m: number, d: number, h = 9) =>
  new Date(y, m - 1, d, h);
const ymd = (d?: Date) => d && [d.getFullYear(), d.getMonth() + 1, d.getDate()];

describe('nextOccurrence', () => {
  it('uses Monday-start weeks for biweekly rules', () => {
    // Tue Jan 6 2026, every 2 weeks on Tue + Sun: that week's Sunday is Jan 11.
    const next = nextOccurrence(
      local(2026, 1, 6),
      { frequency: 'weekly', interval: 2, byDay: ['TU', 'SU'] },
      local(2026, 1, 7),
    );
    expect(ymd(next)).toEqual([2026, 1, 11]);
  });

  it('counts negative month days from the end of the month', () => {
    const next = nextOccurrence(
      local(2025, 1, 31),
      { frequency: 'monthly', byMonthDay: [-1] },
      local(2026, 4, 2),
    );
    expect(ymd(next)).toEqual([2026, 4, 30]);
  });

  it('skips Feb 29 in non-leap years instead of rolling to March 1', () => {
    const next = nextOccurrence(
      local(2024, 2, 29),
      { frequency: 'yearly' },
      local(2025, 1, 1),
    );
    expect(ymd(next)).toEqual([2028, 2, 29]);
  });

  it('stops after COUNT occurrences', () => {
    expect(
      nextOccurrence(
        local(2026, 1, 5),
        { frequency: 'daily', count: 3 },
        local(2026, 1, 10),
      ),
    ).toBeUndefined();
  });
});

describe("nextOccurrence in the event's own time zone (on a UTC device)", () => {
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it('keeps a 09:00 Prague meeting at 09:00 across the October DST change', () => {
    // 09:00 CEST is 07:00Z; after Oct 25, 09:00 CET is 08:00Z.
    const next = nextOccurrence(
      new Date('2026-10-01T07:00:00Z'),
      { frequency: 'weekly' },
      new Date('2026-10-26T00:00:00Z'),
      0,
      'Europe/Prague',
    );
    expect(next?.toISOString()).toBe('2026-10-29T08:00:00.000Z');
  });

  it("picks BYDAY weekdays in the event's zone, not the device's", () => {
    // Mon Nov 2 00:30 in Prague is still Sunday in UTC.
    const next = nextOccurrence(
      new Date('2026-11-01T23:30:00Z'),
      { frequency: 'weekly', byDay: ['MO', 'WE'] },
      new Date('2026-11-03T12:00:00Z'),
      0,
      'Europe/Prague',
    );
    // Wed Nov 4 00:30 Prague.
    expect(next?.toISOString()).toBe('2026-11-03T23:30:00.000Z');
  });

  it('falls back to device time for a zone Intl does not know', () => {
    const next = nextOccurrence(
      new Date('2026-10-01T07:00:00Z'),
      { frequency: 'weekly' },
      new Date('2026-10-26T00:00:00Z'),
      0,
      'Not/AZone',
    );
    expect(next?.toISOString()).toBe('2026-10-29T07:00:00.000Z');
  });
});
