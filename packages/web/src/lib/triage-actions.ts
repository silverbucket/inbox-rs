import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import { get } from 'svelte/store';
import { recordCollectionUse } from './collection-suggest';
import type { Plan } from './plan';
import {
  flushItemChanges,
  items,
  moveItemToCollection,
  restoreItem,
  setItemArchived,
  type TriageChange,
  triageToTodo,
} from './stores';
import { showToast } from './toast';

/**
 * Inbox triage actions shared by the Process inbox panel and the cards'
 * "File to …?" hint. Each one confirms with a toast that can undo it, and
 * reports failure with a toast rather than throwing, so callers only need
 * the returned success flag. `onundo` runs once an undo has landed.
 */

/** The toast's Undo: revert the change, then let the caller catch up. */
function undoTo(change: TriageChange, onundo?: () => void) {
  return {
    label: 'Undo',
    run: () => {
      restoreItem(change).then(
        (restored) => {
          if (restored) onundo?.();
          else showToast('That card is gone, so there’s nothing to undo');
        },
        (error) => {
          console.error('Failed to undo triage action', error);
          showToast('Couldn’t undo that');
        },
      );
    },
  };
}

/** The card as stored right now, buffered remote edits included. */
function fresh(item: InboxItem): InboxItem {
  flushItemChanges();
  return get(items)[item.id] ?? item;
}

/** File an inbox card into a collection. */
export async function fileFromInbox(
  item: InboxItem,
  collection: Collection,
  onundo?: () => void,
): Promise<boolean> {
  const before = fresh(item);
  try {
    await moveItemToCollection(item.id, collection.id);
    recordCollectionUse(collection.id);
    const after = get(items)[item.id] ?? before;
    showToast(`Filed to ${collection.name}`, undoTo({ before, after }, onundo));
    return true;
  } catch (error) {
    console.error('Failed to file inbox item', error);
    showToast('Couldn’t file that card');
    return false;
  }
}

/** Archive an inbox card. */
export async function archiveFromInbox(
  item: InboxItem,
  onundo?: () => void,
): Promise<boolean> {
  const before = fresh(item);
  try {
    await setItemArchived(item.id, true);
    const after = get(items)[item.id] ?? before;
    showToast('Archived', undoTo({ before, after }, onundo));
    return true;
  } catch (error) {
    console.error('Failed to archive inbox item', error);
    showToast('Couldn’t archive that card');
    return false;
  }
}

/**
 * Make an inbox card a todo for a horizon or a day. `label` names it in
 * the toast ("This week").
 */
export async function todoFromInbox(
  item: InboxItem,
  when: { plan: Plan } | { day: Date },
  label: string,
  onundo?: () => void,
): Promise<boolean> {
  try {
    const change = await triageToTodo(item, when);
    showToast(`Moved to Todos · ${label}`, undoTo(change, onundo));
    return true;
  } catch (error) {
    console.error('Failed to make inbox item a todo', error);
    showToast('Couldn’t make that a todo');
    return false;
  }
}
