import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import { get } from 'svelte/store';
import { recordCollectionUse } from './collection-suggest';
import type { Plan } from './plan';
import {
  items,
  moveItemToCollection,
  restoreItem,
  setItemArchived,
  triageToTodo,
} from './stores';
import { showToast } from './toast';

/**
 * Inbox triage actions shared by the Process inbox panel and the cards'
 * "File to …?" hint. Each one confirms with a toast that can undo it, and
 * reports failure with a toast rather than throwing, so callers only need
 * the returned success flag. `onundo` runs once an undo has landed.
 */

function undoTo(before: InboxItem, onundo?: () => void) {
  return {
    label: 'Undo',
    run: () => {
      restoreItem(before).then(onundo, (error) => {
        console.error('Failed to undo triage action', error);
        showToast('Couldn’t undo that');
      });
    },
  };
}

export async function fileFromInbox(
  item: InboxItem,
  collection: Collection,
  onundo?: () => void,
): Promise<boolean> {
  const before = get(items)[item.id] ?? item;
  try {
    await moveItemToCollection(item.id, collection.id);
    recordCollectionUse(collection.id);
    showToast(`Filed to ${collection.name}`, undoTo(before, onundo));
    return true;
  } catch (error) {
    console.error('Failed to file inbox item', error);
    showToast('Couldn’t file that card');
    return false;
  }
}

export async function archiveFromInbox(
  item: InboxItem,
  onundo?: () => void,
): Promise<boolean> {
  const before = get(items)[item.id] ?? item;
  try {
    await setItemArchived(item.id, true);
    showToast('Archived', undoTo(before, onundo));
    return true;
  } catch (error) {
    console.error('Failed to archive inbox item', error);
    showToast('Couldn’t archive that card');
    return false;
  }
}

/** `label` names the horizon or day for the toast ("This week"). */
export async function todoFromInbox(
  item: InboxItem,
  when: { plan: Plan } | { day: Date },
  label: string,
  onundo?: () => void,
): Promise<boolean> {
  try {
    const before = await triageToTodo(item, when);
    showToast(`Moved to Todos · ${label}`, undoTo(before, onundo));
    return true;
  } catch (error) {
    console.error('Failed to make inbox item a todo', error);
    showToast('Couldn’t make that a todo');
    return false;
  }
}
