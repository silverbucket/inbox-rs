/**
 * Orchestrates posting a card's schedule to a CalDAV calendar via the
 * sockethub relay: create vs update vs move, entry removal, and best-effort
 * completion sync for tasks. The card is always the source of truth — these
 * helpers only maintain the calendar-side projection and the stored
 * eventUrl/eventEtag pointing at it.
 */
import type { InboxItem } from '@inbox-rs/rs-module';
import { CaldavError, createEntry, deleteEntry, updateEntry } from './caldav';
import {
  accountEndpoint,
  choiceForEventUrl,
  findCalendarChoice,
  recordCalendarUse,
} from './calendar-accounts';
import { cleanForStorage } from './clean-for-storage';
import { applySchedule, type PendingSchedule } from './schedule';
import { storeItem } from './stores';

/**
 * Post the (already locally saved) scheduled item to `calendarId`. Handles
 * all three shapes: first post (create), same-calendar change (update), and
 * calendar move (delete from the old calendar, create in the new one).
 * Returns the item with its eventUrl/eventEtag refreshed — the caller
 * persists it.
 */
export async function postScheduledItem(
  item: InboxItem,
  calendarId: string,
): Promise<InboxItem> {
  const target = findCalendarChoice(calendarId);
  if (!target) throw new CaldavError('caldav:invalid-calendar');

  const current = choiceForEventUrl(item.eventUrl);
  if (item.eventUrl && current && current.calendar.id === calendarId) {
    const posted = await updateEntry(
      current.account,
      calendarId,
      item,
      accountEndpoint(current.account),
    );
    return { ...item, ...posted };
  }
  if (item.eventUrl && current) {
    // Moving calendars: remove the old projection first. A vanished entry
    // (deleted out-of-band in the calendar app) is fine — the goal state is
    // "not there", and create below still runs.
    try {
      await deleteEntry(
        current.account,
        current.calendar.id,
        item,
        accountEndpoint(current.account),
      );
    } catch (err) {
      if (!(err instanceof CaldavError && err.code === 'caldav:not-found')) {
        throw err;
      }
    }
  }
  const posted = await createEntry(
    target.account,
    calendarId,
    item,
    accountEndpoint(target.account),
  );
  return { ...item, ...posted };
}

/**
 * Delete the item's posted entry. Resolves (with no value) once the calendar
 * no longer has the entry — deleted now, already gone, or never posted;
 * throws only when the server refused and the entry may still exist.
 */
export async function removePostedEntry(item: InboxItem): Promise<void> {
  const current = choiceForEventUrl(item.eventUrl);
  if (!item.eventUrl || !current) return;
  try {
    await deleteEntry(
      current.account,
      current.calendar.id,
      item,
      accountEndpoint(current.account),
    );
  } catch (err) {
    if (err instanceof CaldavError && err.code === 'caldav:not-found') return;
    throw err;
  }
}

/**
 * The shared completion toggle: persists the flip locally, then — for tasks
 * with a posted entry — syncs STATUS:COMPLETED to the calendar best-effort.
 * Calendar failures never block or revert the local toggle; the next
 * successful post refreshes the projection.
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

  if (item.scheduleKind !== 'task' || !item.eventUrl || !item.eventEtag) {
    return;
  }
  const current = choiceForEventUrl(item.eventUrl);
  if (!current) return;
  try {
    const posted = await updateEntry(
      current.account,
      current.calendar.id,
      updated,
      accountEndpoint(current.account),
    );
    await storeItem(cleanForStorage({ ...updated, ...posted }));
  } catch (err) {
    console.warn('Calendar completion sync failed (kept local state)', err);
  }
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
 * Post the item to a calendar and apply the ownership rule: in 'move' mode
 * (the default) the calendar owns the item now, so it is archived out of
 * its surface's active lists — any kind, filed or not. 'copy' mode posts
 * without archiving. Only the first post can archive; relocating an
 * already-posted entry between calendars never changes archive state.
 * Returns the stored item.
 */
export async function addItemToCalendar(
  item: InboxItem,
  calendarId: string,
  mode: 'move' | 'copy' = 'move',
): Promise<InboxItem> {
  const firstPost = !item.eventUrl;
  let posted = await postScheduledItem(item, calendarId);
  if (firstPost && mode === 'move') {
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
 * Bring a moved item back under the app's management WITHOUT touching the
 * calendar: only the archive state clears; the entry link stays, so the
 * item becomes a copy (time edits and completion keep syncing, and it
 * alerts in-app again). What happens to the calendar's copy is the
 * calendar's business — inbox-rs never deletes entries on the user's
 * behalf outside its own sync maintenance.
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

export { recordCalendarUse };
