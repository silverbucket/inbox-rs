import { describe, expect, it } from 'vitest';
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
