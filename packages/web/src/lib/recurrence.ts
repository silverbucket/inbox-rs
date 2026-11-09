/**
 * The next occurrence of a repeating calendar entry. A repeating event is
 * one card showing its next date, so this walks the series (in local wall
 * clock time) to the first occurrence that hasn't ended by `after`.
 * Covers the rule parts platform-caldav models: frequency, interval,
 * count, until, byDay (weekly) and byMonthDay (monthly).
 */
import type { RemoteRecurrence } from './caldav';

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_STEPS = 20_000;

function* occurrences(start: Date, rule: RemoteRecurrence): Generator<Date> {
  const interval = Math.max(1, rule.interval ?? 1);
  const days = (rule.byDay ?? [])
    .map((d) => DAY_CODES.indexOf(d.slice(-2).toUpperCase()))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  for (let step = 0; step < MAX_STEPS; step++) {
    const base = new Date(start);
    switch (rule.frequency) {
      case 'daily':
        base.setDate(start.getDate() + step * interval);
        yield base;
        break;
      case 'weekly': {
        base.setDate(start.getDate() + step * interval * 7);
        if (days.length === 0) {
          yield base;
          break;
        }
        const weekStart = new Date(base);
        weekStart.setDate(base.getDate() - base.getDay());
        for (const day of days) {
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + day);
          if (d >= start) yield d;
        }
        break;
      }
      case 'monthly': {
        const monthDays = rule.byMonthDay?.length
          ? [...rule.byMonthDay].sort((a, b) => a - b)
          : [start.getDate()];
        for (const md of monthDays) {
          const d = new Date(start);
          d.setDate(1);
          d.setMonth(start.getMonth() + step * interval);
          const month = d.getMonth();
          d.setDate(md);
          if (d.getMonth() !== month) continue; // e.g. the 31st in April
          if (d >= start) yield d;
        }
        break;
      }
      case 'yearly':
        base.setFullYear(start.getFullYear() + step * interval);
        yield base;
        break;
      default:
        return;
    }
  }
}

/**
 * The first occurrence that ends at or after `after`, or undefined when the
 * series is over. `durationMs` is how long each occurrence lasts.
 */
export function nextOccurrence(
  start: Date,
  rule: RemoteRecurrence,
  after: Date,
  durationMs = 0,
): Date | undefined {
  const until = rule.until ? new Date(rule.until) : undefined;
  let seen = 0;
  for (const occurrence of occurrences(start, rule)) {
    seen++;
    if (rule.count && seen > rule.count) return undefined;
    if (until && occurrence > until) return undefined;
    if (occurrence.getTime() + durationMs >= after.getTime()) return occurrence;
  }
  return undefined;
}

/** "Repeats weekly", "Repeats every 2 weeks" … */
export function describeRecurrence(rule: RemoteRecurrence): string {
  const unit = {
    daily: 'day',
    weekly: 'week',
    monthly: 'month',
    yearly: 'year',
  }[rule.frequency];
  const interval = Math.max(1, rule.interval ?? 1);
  if (!unit) return 'Repeats';
  return interval === 1
    ? `Repeats ${rule.frequency}`
    : `Repeats every ${interval} ${unit}s`;
}
