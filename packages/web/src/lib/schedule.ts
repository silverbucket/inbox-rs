/**
 * Scheduling helpers: quick-pick time suggestions, schedule formatting for
 * chips, and applying/clearing the schedule fields on an item.
 *
 * All date math is local-time — the user schedules in their own wall-clock;
 * conversion to UTC happens only at .ics/CalDAV serialization (see ics.ts).
 */
import type { InboxItem } from '@inbox-rs/rs-module';

export type ScheduleKind = 'event' | 'task';

export interface QuickOption {
  label: string;
  start: Date;
}

/** The prefilled guess: the next round hour ("14:23" → 15:00). */
export function nextRoundHour(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

/**
 * One-tap suggestions covering the common cases. Options whose moment has
 * already passed are dropped (no "Tonight 19:00" at 22:00).
 */
export function quickOptions(now: Date = new Date()): QuickOption[] {
  const at = (base: Date, addDays: number, hour: number): Date => {
    const d = new Date(base);
    d.setDate(d.getDate() + addDays);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  // Next Saturday (never today — "Sat morning" on a Saturday means next week).
  const untilSaturday = (6 - now.getDay() + 7) % 7 || 7;
  // Next Monday, same rule.
  const untilMonday = (1 - now.getDay() + 7) % 7 || 7;
  const options: QuickOption[] = [
    { label: 'Tonight 19:00', start: at(now, 0, 19) },
    { label: 'Tomorrow 09:00', start: at(now, 1, 9) },
    { label: 'Sat morning', start: at(now, untilSaturday, 10) },
    { label: 'Next week', start: at(now, untilMonday, 9) },
  ];
  return options.filter((o) => o.start.getTime() > now.getTime());
}

/**
 * Chip/row label for a scheduled item: "Fri, Jul 31 · 09:00", date-only when
 * all-day, and with the year appended once it differs from the current one.
 */
export function formatScheduled(
  item: Pick<InboxItem, 'startsAt' | 'allDay'>,
  now: Date = new Date(),
): string {
  if (!item.startsAt) return '';
  const d = new Date(item.startsAt);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  if (item.allDay) return date;
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date} · ${time}`;
}

/** A pending task past its due moment. Events merely become "past", not overdue. */
export function isOverdue(
  item: Pick<InboxItem, 'startsAt' | 'allDay' | 'scheduleKind' | 'completed'>,
  now: Date = new Date(),
): boolean {
  if (!item.startsAt || item.scheduleKind !== 'task' || item.completed) {
    return false;
  }
  const due = new Date(item.startsAt);
  if (item.allDay) due.setHours(23, 59, 59, 999); // due "sometime that day"
  return due.getTime() < now.getTime();
}

/**
 * Membership test for the Todos page's pinned "Due" band: an open,
 * un-archived item whose scheduled *date* is today or earlier. Date-based on
 * purpose — the band's contents only change at midnight or on edits, so
 * derived stores can depend on a once-per-day `todayStart` instead of a
 * ticking clock.
 */
export function isDueTodayOrOverdue(
  item: Pick<InboxItem, 'startsAt' | 'completed' | 'archived'>,
  todayStartMs: number,
): boolean {
  if (!item.startsAt || item.completed || item.archived) return false;
  const d = new Date(item.startsAt);
  if (Number.isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  return d.getTime() <= todayStartMs;
}

/** Earliest due moment first; items without a time sort last. */
export function compareByDueTime(
  a: Pick<InboxItem, 'startsAt'>,
  b: Pick<InboxItem, 'startsAt'>,
): number {
  const at = a.startsAt ? new Date(a.startsAt).getTime() : Infinity;
  const bt = b.startsAt ? new Date(b.startsAt).getTime() : Infinity;
  return at - bt;
}

/** The scheduled moment (or the event's end) is behind us. */
export function isPast(
  item: Pick<InboxItem, 'startsAt' | 'endsAt' | 'allDay'>,
  now: Date = new Date(),
): boolean {
  if (!item.startsAt) return false;
  const end = new Date(item.endsAt ?? item.startsAt);
  if (item.allDay) end.setHours(23, 59, 59, 999);
  return end.getTime() < now.getTime();
}

export interface ScheduleInput {
  kind: ScheduleKind;
  start: Date;
  /** Minutes; only meaningful for timed events. */
  durationMin?: number;
  allDay?: boolean;
}

/**
 * A schedule chosen before its item exists (capture-time "When?" chips).
 * Applied via applySchedule once the item is created. Deliberately
 * calendar-free: setting a time is card metadata; adding to a calendar is a
 * separate action taken later from the card.
 */
export type PendingSchedule = ScheduleInput;

/**
 * Return a copy of the item carrying the given schedule. Any previously
 * posted calendar entry's href/etag is preserved — the caller (future CalDAV
 * sync) uses it to update the projection.
 */
export function applySchedule<T extends InboxItem>(
  item: T,
  input: ScheduleInput,
): T {
  const start = new Date(input.start);
  if (input.allDay) start.setHours(0, 0, 0, 0);
  const endsAt =
    input.kind === 'event' && !input.allDay && input.durationMin
      ? new Date(start.getTime() + input.durationMin * 60_000).toISOString()
      : undefined;
  return {
    ...item,
    startsAt: start.toISOString(),
    endsAt,
    allDay: input.allDay || undefined,
    scheduleKind: input.kind,
  };
}

/**
 * Return a copy of the item with all scheduling removed — including the
 * posted-entry pointer and the archived state that posting may have set.
 */
export function clearSchedule<T extends InboxItem>(item: T): T {
  return {
    ...item,
    startsAt: undefined,
    endsAt: undefined,
    allDay: undefined,
    scheduleKind: undefined,
    ...clearPostedEntryFields(),
  };
}

/**
 * Return a copy of the item detached from its calendar entry, keeping the
 * time. Un-archives: with the calendar no longer owning the card, it
 * returns to the Inbox triage queue.
 */
export function clearPostedEntry<T extends InboxItem>(item: T): T {
  return { ...item, ...clearPostedEntryFields() };
}

function clearPostedEntryFields() {
  return {
    eventUrl: undefined,
    eventEtag: undefined,
    archived: undefined,
    archivedAt: undefined,
  };
}

/** YYYY-MM-DD for <input type="date">, in local time. */
export function toDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** HH:MM for <input type="time">, in local time. */
export function toTimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Combine date + time input values into a local Date. An empty time means
 * midnight (callers treat time-less tasks as all-day). Returns null for an
 * empty/invalid date.
 */
export function fromInputValues(dateStr: string, timeStr: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!dm) return null;
  const tm = /^(\d{2}):(\d{2})$/.exec(timeStr);
  const d = new Date(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    tm ? Number(tm[1]) : 0,
    tm ? Number(tm[2]) : 0,
  );
  // The Date constructor normalizes out-of-range parts ("2026-99-99" rolls
  // into 2034, "12:60" into 13:00) instead of failing — require an exact
  // round-trip of every supplied component.
  const valid =
    d.getFullYear() === Number(dm[1]) &&
    d.getMonth() === Number(dm[2]) - 1 &&
    d.getDate() === Number(dm[3]) &&
    (!tm ||
      (d.getHours() === Number(tm[1]) && d.getMinutes() === Number(tm[2])));
  return valid ? d : null;
}
