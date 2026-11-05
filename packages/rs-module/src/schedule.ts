/**
 * Applying a schedule to an item, shared by the web app and the extension.
 *
 * All date math is local-time — the user schedules in their own wall-clock;
 * conversion to UTC happens only at .ics/CalDAV serialization.
 */
import type { LinkEvent } from './link-metadata.js';
import type { InboxItem } from './types.js';

export type ScheduleKind = 'event' | 'task';

export interface ScheduleInput {
  kind: ScheduleKind;
  start: Date;
  /** Minutes; only meaningful for timed events. */
  durationMin?: number;
  allDay?: boolean;
  /** Omit to keep the item's current location; empty string clears it. */
  location?: string;
}

/**
 * Return a copy of the item carrying the given schedule, dropping any soft
 * plan (a date supersedes "roughly when"). Any previously
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
    // A real date replaces any soft plan ("next week") — see plan.ts.
    planKind: undefined,
    planStart: undefined,
    ...(input.location !== undefined
      ? { location: input.location.trim() || undefined }
      : {}),
  };
}

/**
 * The page's declared event as a schedule. A date-only start is an all-day
 * event on that local calendar date, never UTC midnight shifted into the
 * previous evening.
 */
export function eventSchedule(event: LinkEvent): ScheduleInput | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(event.startDate);
  const start = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      )
    : new Date(event.startDate);
  if (Number.isNaN(start.getTime())) return null;
  const end = event.endDate ? new Date(event.endDate) : null;
  // Exact, not rounded: any positive span is truthy and keeps its end.
  const durationMin =
    end && !dateOnly && end > start
      ? (end.getTime() - start.getTime()) / 60_000
      : undefined;
  return {
    kind: 'event',
    start,
    durationMin,
    allDay: !!dateOnly,
    location: event.location,
  };
}
