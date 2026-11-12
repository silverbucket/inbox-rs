/**
 * Soft planning — "roughly when" for todos, without a deadline.
 *
 * A todo carries at most one of:
 *   - a real date (`startsAt`, see schedule.ts), which always wins, or
 *   - a soft plan (`planKind` + `planStart`): Up next, a week, a month, or
 *     Someday.
 *
 * The Todos page groups open todos into horizon sections derived from that
 * data and the current day. Nothing is rewritten as time passes: a week or
 * month plan whose period has ended simply reads as "rolled over" and lands
 * in Up next, tagged with where it came from. That keeps roll-forward free
 * of writes (no sync churn, no conflicts between devices).
 *
 * Weeks start on Monday, matching the "Next week" quick option in
 * schedule.ts. All math is local wall-clock time.
 */
import {
  applySchedule,
  type InboxItem,
  type PlanKind,
} from '@inbox-rs/rs-module';

export type { PlanKind };

/** Todos-page sections, in display order. */
export type HorizonSection =
  | 'next'
  | 'week'
  | 'nextWeek'
  | 'month'
  | 'nextMonth'
  | 'later'
  | 'someday'
  | 'unplanned';

export const HORIZON_ORDER: HorizonSection[] = [
  'next',
  'week',
  'nextWeek',
  'month',
  'nextMonth',
  'later',
  'someday',
  'unplanned',
];

/** Folded unless the user opens them — far horizons stay out of the way. */
export const DEFAULT_COLLAPSED: HorizonSection[] = [
  'month',
  'nextMonth',
  'later',
  'someday',
];

/** A choice in the "When?" sheet's soft-plan row. */
export type PlanChoice =
  | 'next'
  | 'week'
  | 'nextWeek'
  | 'month'
  | 'nextMonth'
  | 'someday';

export const PLAN_CHOICES: PlanChoice[] = [
  'next',
  'week',
  'nextWeek',
  'month',
  'nextMonth',
  'someday',
];

/** The stored shape of a soft plan. */
export interface Plan {
  planKind: PlanKind;
  planStart?: string;
}

export interface Placement {
  section: HorizonSection;
  /**
   * Set when a week/month plan's period has already ended and the todo has
   * rolled into Up next: a short "from last week" / "from October" label.
   */
  rolledFrom?: string;
}

// ── Date helpers ───────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return t;
}

/** Monday 00:00 of the week containing `d`. */
export function weekStart(d: Date): Date {
  const t = startOfDay(d);
  const offset = (t.getDay() + 6) % 7; // Mon=0 … Sun=6
  t.setDate(t.getDate() - offset);
  return t;
}

/** The 1st, 00:00, of the month containing `d`. */
export function monthStart(d: Date): Date {
  const t = startOfDay(d);
  t.setDate(1);
  return t;
}

function addDays(d: Date, n: number): Date {
  const t = new Date(d);
  t.setDate(t.getDate() + n);
  return t;
}

function addMonths(d: Date, n: number): Date {
  const t = new Date(d);
  t.setDate(1);
  t.setMonth(t.getMonth() + n);
  return t;
}

/** Local YYYY-MM-DD. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a local YYYY-MM-DD; null when malformed. */
export function fromDateKey(key: string | undefined): Date | null {
  if (!key) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [y, mo, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const d = new Date(y, mo, day);
  if (Number.isNaN(d.getTime())) return null;
  // Reject dates JS silently rolls over ("2026-02-31" → March 3).
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) {
    return null;
  }
  return d;
}

const monthName = (d: Date, now: Date) =>
  d.toLocaleDateString(undefined, {
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });

const shortDate = (d: Date) =>
  d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// ── Plan construction ──────────────────────────────────────────────────────

/** The stored plan for a "When?" soft choice, anchored to `now`. */
export function planFor(choice: PlanChoice, now: Date = new Date()): Plan {
  switch (choice) {
    case 'next':
      return { planKind: 'next' };
    case 'someday':
      return { planKind: 'someday' };
    case 'week':
      return { planKind: 'week', planStart: toDateKey(weekStart(now)) };
    case 'nextWeek':
      return {
        planKind: 'week',
        planStart: toDateKey(addDays(weekStart(now), 7)),
      };
    case 'month':
      return { planKind: 'month', planStart: toDateKey(monthStart(now)) };
    case 'nextMonth':
      return {
        planKind: 'month',
        planStart: toDateKey(addMonths(monthStart(now), 1)),
      };
  }
}

/** Which soft choice (if any) an item's current plan corresponds to today. */
export function choiceOf(
  item: Pick<InboxItem, 'planKind' | 'planStart' | 'startsAt'>,
  now: Date = new Date(),
): PlanChoice | null {
  if (item.startsAt || !item.planKind) return null;
  for (const c of PLAN_CHOICES) {
    const p = planFor(c, now);
    if (p.planKind === item.planKind && p.planStart === item.planStart) {
      return c;
    }
  }
  return null;
}

/** Return the item with a soft plan set and any date removed by the caller. */
export function applyPlan<T extends InboxItem>(item: T, plan: Plan): T {
  const next = { ...item, planKind: plan.planKind } as T;
  if (plan.planStart) next.planStart = plan.planStart;
  else delete next.planStart;
  return next;
}

/** Return the item with no soft plan. */
export function clearPlan<T extends InboxItem>(item: T): T {
  const next = { ...item };
  delete next.planKind;
  delete next.planStart;
  return next;
}

// ── Placement ──────────────────────────────────────────────────────────────

/** Section for a date (or period start) that is today or later. */
function sectionForDate(d: Date, now: Date): HorizonSection {
  const thisWeek = weekStart(now);
  const nextWeek = addDays(thisWeek, 7);
  const afterNextWeek = addDays(thisWeek, 14);
  const thisMonth = monthStart(now);
  const nextMonth = addMonths(thisMonth, 1);
  const monthAfter = addMonths(thisMonth, 2);
  const t = d.getTime();
  if (t < nextWeek.getTime()) return 'week';
  if (t < afterNextWeek.getTime()) return 'nextWeek';
  if (t < nextMonth.getTime()) return 'month';
  if (t < monthAfter.getTime()) return 'nextMonth';
  return 'later';
}

/**
 * Where an open todo sits on the Todos page. Callers handle the due/overdue
 * band separately (see `isDueTodayOrOverdue`); a dated todo reaching here is
 * in the future and is placed by its date.
 *
 * Precedence: real date → soft plan → pinned (treated as Up next, so
 * existing pins carry over without a migration) → not planned.
 */
export function placeTodo(
  item: Pick<InboxItem, 'startsAt' | 'planKind' | 'planStart' | 'pinned'>,
  now: Date = new Date(),
): Placement {
  if (item.startsAt) {
    const d = new Date(item.startsAt);
    if (!Number.isNaN(d.getTime())) {
      const day = startOfDay(d);
      // Past dates belong to the due band; if one slips through, keep it
      // near the top rather than losing it.
      if (day.getTime() < startOfDay(now).getTime()) return { section: 'next' };
      return { section: sectionForDate(day, now) };
    }
  }
  switch (item.planKind) {
    case 'next':
      return { section: 'next' };
    case 'someday':
      return { section: 'someday' };
    case 'week': {
      const start = fromDateKey(item.planStart);
      if (!start) return { section: 'next' };
      const thisWeek = weekStart(now);
      if (start.getTime() < thisWeek.getTime()) {
        const lastWeek = addDays(thisWeek, -7);
        return {
          section: 'next',
          rolledFrom:
            start.getTime() === lastWeek.getTime()
              ? 'from last week'
              : `from week of ${shortDate(start)}`,
        };
      }
      return { section: sectionForDate(start, now) };
    }
    case 'month': {
      const start = fromDateKey(item.planStart);
      if (!start) return { section: 'next' };
      const thisMonth = monthStart(now);
      if (start.getTime() < thisMonth.getTime()) {
        return { section: 'next', rolledFrom: `from ${monthName(start, now)}` };
      }
      if (start.getTime() === thisMonth.getTime()) return { section: 'month' };
      const nextMonth = addMonths(thisMonth, 1);
      if (start.getTime() === nextMonth.getTime()) {
        return { section: 'nextMonth' };
      }
      return { section: 'later' };
    }
  }
  if (item.pinned) return { section: 'next' };
  return { section: 'unplanned' };
}

// ── Labels ─────────────────────────────────────────────────────────────────

export interface SectionInfo {
  label: string;
  /** Short date range or hint shown beside the label. */
  range: string;
}

/** Labels for a section, relative to `now`. */
export function sectionInfo(
  section: HorizonSection,
  now: Date = new Date(),
): SectionInfo {
  const thisWeek = weekStart(now);
  const nextWeek = addDays(thisWeek, 7);
  const thisMonth = monthStart(now);
  const nextMonth = addMonths(thisMonth, 1);
  const lastOfMonth = addDays(nextMonth, -1);
  const fmtRange = (a: Date, b: Date) => `${shortDate(a)} – ${shortDate(b)}`;
  switch (section) {
    case 'next':
      return { label: 'Up next', range: 'no date, soon' };
    case 'week': {
      const sunday = addDays(thisWeek, 6);
      const weekday = sunday.toLocaleDateString(undefined, {
        weekday: 'short',
      });
      return {
        label: 'This week',
        range: `until ${weekday} ${sunday.getDate()}`,
      };
    }
    case 'nextWeek':
      return {
        label: 'Next week',
        range: fmtRange(nextWeek, addDays(nextWeek, 6)),
      };
    case 'month':
      return {
        label: 'Later this month',
        range: `until ${shortDate(lastOfMonth)}`,
      };
    case 'nextMonth':
      return { label: 'Next month', range: monthName(nextMonth, now) };
    case 'later':
      return { label: 'Later', range: 'dated further out' };
    case 'someday':
      return { label: 'Someday', range: 'parked, no pressure' };
    case 'unplanned':
      return { label: 'Not planned yet', range: '' };
  }
}

/** Label + hint for a "When?" soft choice. */
export function choiceInfo(
  choice: PlanChoice,
  now: Date = new Date(),
): SectionInfo {
  if (choice === 'month') {
    return { label: 'This month', range: sectionInfo('month', now).range };
  }
  return sectionInfo(choice, now);
}

/** Compact chip label for an item's soft plan ("Next week"), or ''. */
export function planLabel(
  item: Pick<InboxItem, 'startsAt' | 'planKind' | 'planStart' | 'pinned'>,
  now: Date = new Date(),
): string {
  if (item.startsAt || !item.planKind) return '';
  const { section } = placeTodo(item, now);
  return sectionInfo(section, now).label;
}

/** Stable CSS colour token per section (defined in global.css). */
export function sectionColorVar(section: HorizonSection): string {
  return `var(--horizon-${section})`;
}

// ── Calendar helpers ───────────────────────────────────────────────────────

/**
 * The weeks (Monday-first) covering a month, each as seven local-midnight
 * dates. Leading and trailing days from neighbouring months fill the first
 * and last rows.
 */
export function monthGrid(month: Date): Date[][] {
  const first = monthStart(month);
  const next = addMonths(first, 1);
  const weeks: Date[][] = [];
  for (
    let start = weekStart(first);
    start.getTime() < next.getTime();
    start = addDays(start, 7)
  ) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return weeks;
}

/** Shift a month anchor by n months (first of the month). */
export function shiftMonth(month: Date, n: number): Date {
  return addMonths(monthStart(month), n);
}

/** Local date key of an item's scheduled day, or null. */
export function scheduledDayKey(
  item: Pick<InboxItem, 'startsAt'>,
): string | null {
  if (!item.startsAt) return null;
  const d = new Date(item.startsAt);
  return Number.isNaN(d.getTime()) ? null : toDateKey(d);
}

/** Longest span walked day by day; guards against a corrupt `endsAt`. */
const MAX_SPAN_DAYS = 366;

/**
 * Local date keys of every day an item occupies: start through end,
 * inclusive, for a multi-day all-day event; just the start day otherwise.
 * Empty when undated.
 */
export function scheduledDayKeys(
  item: Pick<InboxItem, 'startsAt' | 'endsAt' | 'allDay'>,
): string[] {
  const first = scheduledDayKey(item);
  if (!first) return [];
  const keys = [first];
  if (!item.allDay || !item.endsAt) return keys;
  const end = new Date(item.endsAt);
  if (Number.isNaN(end.getTime())) return keys;
  const last = toDateKey(end);
  // Step by calendar day, not 24 h, so a DST change can't skip or repeat one.
  const d = startOfDay(new Date(item.startsAt as string));
  while (keys.length < MAX_SPAN_DAYS) {
    d.setDate(d.getDate() + 1);
    const key = toDateKey(d);
    if (key > last) break;
    keys.push(key);
  }
  return keys;
}

/**
 * "Day 2 of 3" when `key` is a later day of the item's multi-day span;
 * empty on its first day, on single-day items, and outside the span.
 */
export function spanDayLabel(
  item: Pick<InboxItem, 'startsAt' | 'endsAt' | 'allDay'>,
  key: string,
): string {
  const keys = scheduledDayKeys(item);
  const i = keys.indexOf(key);
  return i > 0 ? `Day ${i + 1} of ${keys.length}` : '';
}

/**
 * The schedule for moving an item to `day`: an all-day task when it had no
 * time (or no date), otherwise the same clock time on the new day. A timed
 * item with an end keeps its duration.
 */
export function moveToDay(
  item: Pick<InboxItem, 'startsAt' | 'endsAt' | 'allDay' | 'scheduleKind'>,
  day: Date,
): {
  kind: 'event' | 'task';
  start: Date;
  allDay: boolean;
  durationMin?: number;
} {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const old = item.startsAt ? new Date(item.startsAt) : null;
  const timed = !!old && !Number.isNaN(old.getTime()) && !item.allDay;
  if (timed && old) start.setHours(old.getHours(), old.getMinutes(), 0, 0);
  const end = item.endsAt ? new Date(item.endsAt) : null;
  const durationMin =
    timed && old && end && !Number.isNaN(end.getTime())
      ? Math.max(1, Math.round((end.getTime() - old.getTime()) / 60_000))
      : undefined;
  return {
    kind: item.scheduleKind ?? 'task',
    start,
    allDay: !timed,
    ...(durationMin !== undefined ? { durationMin } : {}),
  };
}

/**
 * Return a copy of the item rescheduled onto `day`, keeping what the move
 * shouldn't change: a timed event's duration, and a multi-day all-day
 * event's length (its end shifts by the same number of days).
 */
export function moveItemToDay<T extends InboxItem>(item: T, day: Date): T {
  const moved = applySchedule(item, moveToDay(item, day));
  if (item.allDay && item.startsAt && item.endsAt) {
    const oldStart = new Date(item.startsAt);
    const oldEnd = new Date(item.endsAt);
    if (!Number.isNaN(oldStart.getTime()) && !Number.isNaN(oldEnd.getTime())) {
      // Shift by calendar days, not elapsed time: across a daylight-saving
      // change a day is 23 or 25 hours, and adding milliseconds would land
      // the end at 23:00 or 01:00 instead of local midnight.
      const from = startOfDay(oldStart);
      const to = startOfDay(day);
      const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
      const end = new Date(oldEnd);
      end.setDate(end.getDate() + days);
      moved.endsAt = end.toISOString();
    }
  }
  return moved;
}
