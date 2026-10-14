/**
 * Calendar sync via the sockethub relay.
 *
 * A card's calendar entry is a live projection of the card: putting a card
 * on a calendar CREATES the entry, later edits (time, title, completion)
 * UPDATE it, and taking the card off the calendar — or clearing its time,
 * or deleting the card — DELETES it. `eventUrl`/`eventEtag` on the item
 * are the pointer to that entry. With the per-kind "auto" preference on,
 * every card that gets a time lands on the default calendar without asking.
 *
 * Calendar traffic is best-effort relative to the card itself: the card is
 * always stored first, and a failed relay call surfaces as a toast rather
 * than blocking the edit. The exception is a conflict (`caldav:conflict`):
 * the user edited that entry in their calendar app, so we leave it alone
 * and tell them.
 */
import type { InboxItem } from '@inbox-rs/rs-module';
import { get } from 'svelte/store';
import { CaldavError, createEntry, deleteEntry, updateEntry } from './caldav';
import {
  accountEndpoint,
  autoSyncCalendar,
  type CalendarChoice,
  choiceForEventUrl,
  findCalendarChoice,
  recordCalendarUse,
} from './calendar-accounts';
import { cleanForStorage } from './clean-for-storage';
import {
  applySchedule,
  clearPostedEntry,
  type PendingSchedule,
  type ScheduleKind,
} from './schedule';
import { items, storeItem } from './stores';
import { showToast } from './toast';

export function scheduleKindOf(item: InboxItem): ScheduleKind {
  return (
    item.scheduleKind ??
    (item.isTodo || item.type === 'todo' ? 'task' : 'event')
  );
}

function friendly(err: unknown): string {
  return err instanceof CaldavError
    ? err.message
    : 'the calendar relay is unreachable';
}

/** Where the item's entry lives; undefined when it has none, or its account is gone. */
export function entryHome(item: InboxItem): CalendarChoice | undefined {
  return choiceForEventUrl(item.eventUrl);
}

async function create(
  item: InboxItem,
  target: CalendarChoice,
): Promise<InboxItem> {
  const receipt = await createEntry(
    target.account,
    target.calendar.id,
    item,
    accountEndpoint(target.account),
  );
  recordCalendarUse(scheduleKindOf(item), target.calendar.id);
  return storeReceipt(item, receipt);
}

/**
 * Store the pointer onto the card as it is NOW, not as it was when the
 * relay call started: an autosave can land in between, and writing the
 * older snapshot back would silently revert it.
 */
async function storeReceipt(
  item: InboxItem,
  receipt: { eventUrl: string; eventEtag?: string },
): Promise<InboxItem> {
  const latest = get(items)[item.id] ?? item;
  const posted = { ...latest, ...receipt };
  await storeItem(cleanForStorage(posted));
  return posted;
}

async function update(
  item: InboxItem,
  home: CalendarChoice,
): Promise<InboxItem> {
  const receipt = await updateEntry(
    home.account,
    home.calendar.id,
    item,
    accountEndpoint(home.account),
  );
  return storeReceipt(item, receipt);
}

/**
 * Remove the entry. An entry that is already gone (`not-found`), or whose
 * account was removed from this device, counts as removed. Everything else
 * propagates so the caller can decide whether the card still claims it.
 */
async function remove(item: InboxItem): Promise<void> {
  const home = entryHome(item);
  if (!home || !item.eventUrl) return;
  try {
    await deleteEntry(
      home.account,
      home.calendar.id,
      item,
      accountEndpoint(home.account),
    );
  } catch (err) {
    if (err instanceof CaldavError && err.code === 'caldav:not-found') return;
    throw err;
  }
}

/**
 * Put the card on `calendarId`, or take it off every calendar with null.
 * Moving between calendars is delete + create. The card itself is stored
 * with its new pointer; it never archives — the card stays wherever it
 * lives in the app and the calendar mirrors it.
 */
export async function setItemCalendar(
  item: InboxItem,
  calendarId: string | null,
): Promise<InboxItem> {
  const current = entryHome(item);
  if (calendarId && current?.calendar.id === calendarId) return item;
  const target = calendarId ? findCalendarChoice(calendarId) : undefined;
  if (calendarId && !target) throw new CaldavError('caldav:invalid-calendar');
  if (item.eventUrl) await remove(item);
  const detached = clearPostedEntry(item);
  if (!target) {
    await storeItem(cleanForStorage(detached));
    return detached;
  }
  return create(detached, target);
}

/**
 * Keep the entry in step after the card changed. `prev` is the card as it
 * was before the edit, `next` as stored now. Handles:
 *   - time cleared          → delete the entry
 *   - kind flipped          → delete + create (a VEVENT can't become a VTODO)
 *   - already on a calendar → update
 *   - newly timed, auto on  → create on the default calendar
 * Returns the stored card (with an updated pointer when one changed).
 * Relay failures toast and leave the card as stored; nothing throws.
 */
export async function syncEntry(
  prev: InboxItem | undefined,
  next: InboxItem,
): Promise<InboxItem> {
  try {
    const home = entryHome(next);
    if (next.eventUrl && !home) {
      // The account that holds this entry is gone from this device —
      // nothing we can do about the entry; stop claiming it.
      const detached = clearPostedEntry(next);
      await storeItem(cleanForStorage(detached));
      return detached;
    }
    if (next.eventUrl && home) {
      if (!next.startsAt) {
        // The card has no time, so it leaves the calendar no matter what:
        // a failed delete is reported, but the pointer goes either way.
        const detached = clearPostedEntry(next);
        try {
          await remove(next);
        } catch (err) {
          console.error('Calendar entry removal failed', err);
          showToast(
            `Time removed, but the calendar entry stayed — ${friendly(err)}`,
          );
        }
        await storeItem(cleanForStorage(detached));
        return detached;
      }
      if (prev && scheduleKindOf(prev) !== scheduleKindOf(next)) {
        await remove(next);
        const detached = clearPostedEntry(next);
        if (home.calendar.components.includes(scheduleKindOf(next))) {
          return await create(detached, home);
        }
        await storeItem(cleanForStorage(detached));
        showToast(
          `${home.calendar.name} doesn't hold ${scheduleKindOf(next)}s — removed from the calendar`,
        );
        return detached;
      }
      return await update(next, home);
    }
    if (next.startsAt && !next.eventUrl) {
      const target = autoSyncCalendar(scheduleKindOf(next));
      if (target) return await create(next, target);
    }
    return next;
  } catch (err) {
    console.error('Calendar sync failed', err);
    if (err instanceof CaldavError && err.code === 'caldav:conflict') {
      showToast(
        'Calendar entry left as is — it was changed in your calendar app',
      );
    } else {
      showToast(`Calendar not updated — ${friendly(err)}`);
    }
    return next;
  }
}

/** Best-effort removal when the card itself is deleted. */
export async function removeEntryForDeletedItem(
  item: InboxItem,
): Promise<void> {
  if (!item.eventUrl) return;
  try {
    await remove(item);
  } catch (err) {
    console.error('Calendar entry removal failed', err);
    showToast(`Card deleted, but its calendar entry stayed — ${friendly(err)}`);
  }
}

/** The shared completion toggle. Mirrors completion onto a task entry. */
export async function setItemCompleted(
  item: InboxItem,
  completed: boolean,
): Promise<void> {
  const updated: InboxItem = {
    ...item,
    isTodo: true,
    completed,
    completedAt: completed ? new Date().toISOString() : undefined,
  };
  await storeItem(cleanForStorage(updated));
  if (updated.eventUrl) await syncEntry(item, updated);
}

/**
 * Apply a capture-time schedule to a freshly created item, then let auto
 * sync place it. `item` must already carry its final collectionId (call
 * after any moveItemToCollection).
 */
export async function applyPendingSchedule(
  item: InboxItem,
  pending: PendingSchedule,
): Promise<void> {
  const scheduled = applySchedule(item, pending);
  await storeItem(cleanForStorage(scheduled));
  await syncEntry(item, scheduled);
}

/**
 * Legacy: items archived by the old "move to calendar" mode. Bring the
 * card back under the app's management; its entry stays linked and now
 * syncs like any other.
 */
export async function reEnableFromCalendar(
  item: InboxItem,
): Promise<InboxItem> {
  const updated: InboxItem = {
    ...item,
    archived: undefined,
    archivedAt: undefined,
    archiveReason: undefined,
  };
  await storeItem(cleanForStorage(updated));
  return updated;
}
