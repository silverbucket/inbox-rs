/**
 * One-shot calendar publishing via the sockethub relay. Posting CREATES an
 * entry and stores eventUrl/eventEtag as a receipt — which calendar the item
 * went to, and that it's there. After that, inbox-rs NEVER updates or
 * deletes the entry, no matter what happens to the card: the user's
 * calendar is theirs, and entries must not change or vanish because
 * someone was editing cards in this app. All detach/re-enable operations
 * are local-only.
 */
import type { InboxItem } from '@inbox-rs/rs-module';
import { CaldavError, createEntry } from './caldav';
import {
  accountEndpoint,
  findCalendarChoice,
  recordCalendarUse,
} from './calendar-accounts';
import { cleanForStorage } from './clean-for-storage';
import {
  applySchedule,
  clearPostedEntry,
  type PendingSchedule,
} from './schedule';
import { storeItem } from './stores';

/**
 * The shared completion toggle — local-only. Completing a todo here never
 * touches a posted calendar entry; the calendar's copy is a frozen snapshot.
 */
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
}

/**
 * Apply a capture-time schedule to a freshly created item. Deliberately
 * calendar-free: setting a time is card metadata; adding to a calendar is a
 * separate action taken later from the card. `item` must already carry its
 * final collectionId (call after any moveItemToCollection).
 */
export async function applyPendingSchedule(
  item: InboxItem,
  pending: PendingSchedule,
): Promise<void> {
  await storeItem(cleanForStorage(applySchedule(item, pending)));
}

/**
 * Create the item's calendar entry (one shot — an already-posted item can
 * never be posted again) and apply the ownership rule: in 'move' mode (the
 * default) the calendar owns the item now, so it is archived out of its
 * surface's active lists — any kind, filed or not. 'copy' mode posts
 * without archiving. Returns the stored item.
 */
export async function addItemToCalendar(
  item: InboxItem,
  calendarId: string,
  mode: 'move' | 'copy' = 'move',
): Promise<InboxItem> {
  if (item.eventUrl) {
    throw new Error(
      'Item is already on a calendar — posting is one-shot and never updates entries.',
    );
  }
  const target = findCalendarChoice(calendarId);
  if (!target) throw new CaldavError('caldav:invalid-calendar');
  const receipt = await createEntry(
    target.account,
    calendarId,
    item,
    accountEndpoint(target.account),
  );
  let posted: InboxItem = { ...item, ...receipt };
  if (mode === 'move') {
    posted = {
      ...posted,
      archived: true,
      archivedAt: new Date().toISOString(),
    };
  }
  await storeItem(cleanForStorage(posted));
  return posted;
}

/**
 * Bring a moved item back under the app's management: only the archive
 * state clears. The receipt (eventUrl) stays, so the item reads as a copy,
 * and the calendar entry is not touched.
 */
export async function reEnableFromCalendar(
  item: InboxItem,
): Promise<InboxItem> {
  const updated: InboxItem = {
    ...item,
    archived: undefined,
    archivedAt: undefined,
  };
  await storeItem(cleanForStorage(updated));
  return updated;
}

/**
 * Drop the item's calendar receipt entirely (link + archive state),
 * local-only — the calendar keeps its entry. Used when the card diverges
 * from what was posted beyond what a receipt should claim (e.g. its time
 * was cleared, or it changed kind).
 */
export async function detachFromCalendar(
  item: InboxItem,
): Promise<InboxItem> {
  const updated = clearPostedEntry(item);
  await storeItem(cleanForStorage(updated));
  return updated;
}

export { recordCalendarUse };
