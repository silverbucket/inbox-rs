import type { InboxItem } from '@inbox-rs/rs-module';
import {
  applyCardDraft,
  clearCardDraft,
  createCardDraft,
  draftsEqual,
  listCardDraftIds,
  readCardDraft,
} from './card-draft';

/**
 * Push every card draft this device is still holding into storage.
 *
 * The card editor writes each keystroke to a per-card localStorage draft and
 * clears it once the autosave lands. If the app is closed inside the
 * debounce (tab closed, PWA swiped away, phone backgrounded and killed) the
 * draft is all that survives — and until now it only synced when that exact
 * card was reopened on that exact device. Run this once items are loaded so
 * "close the app" is as safe as "close the card".
 *
 * Drafts for items that aren't loaded are left alone: the item may simply
 * not be in this load (cached mode before connect), and the editor will
 * still restore the draft if the card is opened later.
 *
 * Resolves to the number of drafts written to storage.
 */
export async function replayCardDrafts(
  items: Record<string, InboxItem>,
  storage: Storage,
  store: (item: InboxItem) => Promise<void>,
): Promise<number> {
  let written = 0;
  for (const id of listCardDraftIds(storage)) {
    const item = items[id];
    if (!item) continue;
    const draft = readCardDraft(item, storage);
    if (!draft) {
      // Malformed or for a different card shape — nothing recoverable.
      clearCardDraft(id, storage);
      continue;
    }
    if (draftsEqual(draft, createCardDraft(item))) {
      // Already persisted; the clear just lost the race with the unload.
      clearCardDraft(id, storage);
      continue;
    }
    try {
      await store(applyCardDraft(item, draft));
      clearCardDraft(id, storage);
      written += 1;
    } catch (error) {
      // Keep the draft: the editor retries it the next time the card opens.
      console.error('[inbox] replaying card draft failed:', id, error);
    }
  }
  return written;
}
