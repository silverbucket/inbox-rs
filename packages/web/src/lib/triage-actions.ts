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
 * Organize actions shared by every surface that files or archives a card:
 * the Process inbox panel, the cards' "File to …?" hint, the card modal,
 * and the collection drop targets. Each one confirms with a toast that can
 * undo it, and reports failure with a toast rather than throwing, so
 * callers only need the returned success flag. `onundo` runs once an undo
 * has landed.
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

/**
 * File a card into a collection, or back to the inbox when `collection` is
 * undefined.
 */
export async function fileItem(
  item: InboxItem,
  collection: Collection | undefined,
  onundo?: () => void,
): Promise<boolean> {
  const before = fresh(item);
  try {
    await moveItemToCollection(item.id, collection?.id);
    if (collection) recordCollectionUse(collection.id);
    const after = get(items)[item.id] ?? before;
    showToast(
      collection ? `Filed to ${collection.name}` : 'Moved to Inbox',
      undoTo({ before, after }, onundo),
    );
    return true;
  } catch (error) {
    console.error('Failed to file item', error);
    showToast('Couldn’t file that card');
    return false;
  }
}

/** Archive a card, or restore it from the archive. */
export async function setArchived(
  item: InboxItem,
  archived: boolean,
  onundo?: () => void,
): Promise<boolean> {
  const before = fresh(item);
  try {
    await setItemArchived(item.id, archived);
    const after = get(items)[item.id] ?? before;
    showToast(
      archived ? 'Archived' : 'Restored',
      undoTo({ before, after }, onundo),
    );
    return true;
  } catch (error) {
    console.error('Failed to change archive state', error);
    showToast(
      archived ? 'Couldn’t archive that card' : 'Couldn’t restore that card',
    );
    return false;
  }
}

/** File an inbox card into a collection. */
export function fileFromInbox(
  item: InboxItem,
  collection: Collection,
  onundo?: () => void,
): Promise<boolean> {
  return fileItem(item, collection, onundo);
}

/** Archive an inbox card. */
export function archiveFromInbox(
  item: InboxItem,
  onundo?: () => void,
): Promise<boolean> {
  return setArchived(item, true, onundo);
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

/**
 * Settle a duplicate: archive every copy but the one being kept, with one
 * toast that brings them all back.
 */
export async function archiveCopies(
  copies: InboxItem[],
  onundo?: () => void,
): Promise<boolean> {
  const changes: TriageChange[] = [];
  try {
    for (const copy of copies) {
      const before = fresh(copy);
      await setItemArchived(copy.id, true);
      changes.push({ before, after: get(items)[copy.id] ?? before });
    }
  } catch (error) {
    console.error('Failed to archive a duplicate', error);
    showToast('Couldn’t archive that card');
    return false;
  }
  showToast(
    changes.length === 1
      ? 'Archived the other copy'
      : `Archived the ${changes.length} other copies`,
    {
      label: 'Undo',
      run: () => {
        Promise.all(changes.map((change) => restoreItem(change))).then(
          (restored) => {
            if (restored.some(Boolean)) onundo?.();
            else showToast('Those cards are gone, so there’s nothing to undo');
          },
          (error) => {
            console.error('Failed to undo archiving duplicates', error);
            showToast('Couldn’t undo that');
          },
        );
      },
    },
  );
  return true;
}
