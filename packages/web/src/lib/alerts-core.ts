import type { InboxItem } from '@inbox-rs/rs-module';

/**
 * Pure decision logic for in-app due alerts. The side-effectful scheduler
 * (alerts.ts) feeds it the item map, the fired-key set, and the clock; this
 * module owns *what* fires, *when*, and dedup key semantics — all unit
 * testable with an injected now.
 */

/** All-day items alert at this local hour of their day. */
export const ALL_DAY_ALERT_HOUR = 9;

/** Alerts that became due while the app was closed still fire within this
 *  window; older ones are marked fired silently (they're visible in the due
 *  band — a stale notification flood after reopening helps nobody). */
export const ALERT_GRACE_MS = 30 * 60_000;

/** Fired keys older than this are pruned from storage. */
const FIRED_RETENTION_MS = 7 * 24 * 60 * 60_000;

/** The moment this item's alert should fire, in epoch ms. */
export function alertTimeFor(
  item: Pick<InboxItem, 'startsAt' | 'allDay'>,
): number | null {
  if (!item.startsAt) return null;
  const d = new Date(item.startsAt);
  if (Number.isNaN(d.getTime())) return null;
  // Same local-time convention as isOverdue/isPast in schedule.ts.
  if (item.allDay) d.setHours(ALL_DAY_ALERT_HOUR, 0, 0, 0);
  return d.getTime();
}

/**
 * Whether this item participates in in-app alerting: anything open with a
 * time. Moved items are excluded via `archived` (the calendar owns them);
 * copies alert like any other item — it has a date on it, you expect an
 * alert, no assumptions about what the calendar does with its copy.
 */
export function eligibleForAlert(item: InboxItem): boolean {
  return !!item.startsAt && !item.completed && !item.archived;
}

/** Dedup key: one alert per (item, scheduled moment) — editing the time
 *  re-arms the alert. */
export function alertKey(
  item: Pick<InboxItem, 'id' | 'startsAt'>,
): string {
  return `${item.id}@${item.startsAt}`;
}

/**
 * Partition currently-due, un-fired alerts into `fire` (due within the grace
 * window — deliver now) and `expire` (due longer ago — mark fired silently).
 */
export function collectDueAlerts(
  items: InboxItem[],
  fired: ReadonlySet<string>,
  nowMs: number,
  graceMs: number = ALERT_GRACE_MS,
): { fire: InboxItem[]; expire: string[] } {
  const fire: InboxItem[] = [];
  const expire: string[] = [];
  for (const item of items) {
    if (!eligibleForAlert(item)) continue;
    const due = alertTimeFor(item);
    if (due === null || due > nowMs) continue;
    const key = alertKey(item);
    if (fired.has(key)) continue;
    if (nowMs - due <= graceMs) {
      fire.push(item);
    } else {
      expire.push(key);
    }
  }
  fire.sort((a, b) => (alertTimeFor(a) ?? 0) - (alertTimeFor(b) ?? 0));
  return { fire, expire };
}

/**
 * Drop fired keys that can never matter again: the item is gone, its
 * schedule moved (a fresh key guards the new time), or the key is older
 * than the retention window.
 */
export function pruneFiredKeys(
  keys: string[],
  items: Record<string, InboxItem>,
  nowMs: number,
): string[] {
  return keys.filter((key) => {
    const at = key.lastIndexOf('@');
    if (at <= 0) return false;
    const id = key.slice(0, at);
    const startsAt = key.slice(at + 1);
    const item = items[id];
    if (!item || item.startsAt !== startsAt) return false;
    const due = alertTimeFor(item);
    return due !== null && nowMs - due < FIRED_RETENTION_MS;
  });
}
