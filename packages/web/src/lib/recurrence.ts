/**
 * The next occurrence of a repeating calendar entry. A repeating event is
 * one card showing its next date, so this walks the series to the first
 * occurrence that hasn't ended by `after`. The walk is in the event's own
 * wall-clock time (its zone, or the device's when it has none), so DST
 * changes and weekdays follow the event, not the device.
 * Covers the rule parts platform-caldav models: frequency, interval,
 * count, until, byDay (weekly) and byMonthDay (monthly).
 */
import type { RemoteRecurrence } from './caldav';
import { zonedToUtc } from './ics';

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_STEPS = 20_000;

/** Wall-clock dates: a Date whose UTC fields are the event's local time. */
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
        base.setUTCDate(start.getUTCDate() + step * interval);
        yield base;
        break;
      case 'weekly': {
        base.setUTCDate(start.getUTCDate() + step * interval * 7);
        if (days.length === 0) {
          yield base;
          break;
        }
        // Weeks start on Monday (RFC 5545's default WKST).
        const weekStart = new Date(base);
        weekStart.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
        for (const day of days.map((d) => (d + 6) % 7).sort((a, b) => a - b)) {
          const d = new Date(weekStart);
          d.setUTCDate(weekStart.getUTCDate() + day);
          if (d >= start) yield d;
        }
        break;
      }
      case 'monthly': {
        const monthDays = rule.byMonthDay?.length
          ? [...rule.byMonthDay].sort((a, b) => a - b)
          : [start.getUTCDate()];
        const candidates: Date[] = [];
        for (const md of monthDays) {
          const d = new Date(start);
          d.setUTCDate(1);
          d.setUTCMonth(start.getUTCMonth() + step * interval);
          const month = d.getUTCMonth();
          // Negative days count from the month's end (-1 = the last day).
          const length = new Date(
            Date.UTC(d.getUTCFullYear(), month + 1, 0),
          ).getUTCDate();
          d.setUTCDate(md < 0 ? length + md + 1 : md);
          if (d.getUTCMonth() !== month) continue; // e.g. the 31st in April
          candidates.push(d);
        }
        candidates.sort((a, b) => a.getTime() - b.getTime());
        for (const d of candidates) if (d >= start) yield d;
        break;
      }
      case 'yearly':
        base.setUTCFullYear(start.getUTCFullYear() + step * interval);
        // Feb 29 only occurs in leap years; don't roll into March 1.
        if (base.getUTCMonth() !== start.getUTCMonth()) break;
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
  timeZone?: string,
): Date | undefined {
  const zone = knownZone(timeZone);
  const until = rule.until ? new Date(rule.until) : undefined;
  // Zone offsets stay within ±14h, so a wall time this early can't reach
  // `after`; skipping its conversion keeps long-running series cheap.
  const skipBefore =
    wallClock(after, zone).getTime() - durationMs - 2 * 86_400_000;
  let seen = 0;
  for (const wall of occurrences(wallClock(start, zone), rule)) {
    seen++;
    if (rule.count && seen > rule.count) return undefined;
    if (wall.getTime() < skipBefore) continue;
    const occurrence = toInstant(wall, zone);
    if (until && occurrence > until) return undefined;
    if (occurrence.getTime() + durationMs >= after.getTime()) return occurrence;
  }
  return undefined;
}

/** The zone, if Intl knows it; otherwise the device's (undefined). */
export function knownZone(zone?: string): string | undefined {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/** An instant's wall-clock time in `zone` (or the device's), as UTC fields. */
function wallClock(d: Date, zone?: string): Date {
  if (!zone) {
    return new Date(
      Date.UTC(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        d.getHours(),
        d.getMinutes(),
        d.getSeconds(),
        d.getMilliseconds(),
      ),
    );
  }
  const local = d.toLocaleString('sv-SE', { timeZone: zone }).replace(' ', 'T');
  return new Date(Date.parse(`${local}Z`) + d.getMilliseconds());
}

/** Back from a wall-clock date to the instant it names. */
function toInstant(w: Date, zone?: string): Date {
  const f = [
    w.getUTCFullYear(),
    w.getUTCMonth(),
    w.getUTCDate(),
    w.getUTCHours(),
    w.getUTCMinutes(),
    w.getUTCSeconds(),
  ] as const;
  const ms = w.getUTCMilliseconds();
  if (!zone) return new Date(f[0], f[1], f[2], f[3], f[4], f[5], ms);
  const t = zonedToUtc(f[0], f[1] + 1, f[2], f[3], f[4], f[5], zone);
  return new Date(t.getTime() + ms);
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
