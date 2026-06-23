import type { InboxItem } from '@inbox-rs/rs-module';
import { get } from 'svelte/store';
import { buildBookmarkItem, buildNoteItem } from './build-item';
import { detectCaptureKind } from './capture-detect';
import { collections, moveItemToCollection, storeItem } from './stores';

/** Detect, build and store a quick capture. Returns the created item so the
 *  caller can offer Undo; null when there's nothing to capture. When a
 *  collectionId is given (capturing from a collection view), the item is filed
 *  into that collection. */
export async function captureDetected(
  raw: string,
  collectionId?: string,
): Promise<{ item: InboxItem } | null> {
  const detected = detectCaptureKind(raw);
  const ctx = { id: crypto.randomUUID(), createdAt: new Date().toISOString() };

  if (detected.kind === 'empty') return null;

  // Validate the destination before storing: moveItemToCollection silently
  // no-ops for a missing collection, which would otherwise leave the item in
  // the Inbox while this function still reported success. Fail up front so the
  // caller can surface the error and no orphaned item is left behind.
  if (collectionId && !get(collections)[collectionId]) {
    throw new Error('Target collection no longer exists');
  }

  const built =
    detected.kind === 'bookmark'
      ? buildBookmarkItem(ctx, {
          url: detected.url,
          title: '',
          description: '',
        })
      : buildNoteItem(ctx, { title: '', body: detected.body, description: '' });

  await storeItem(built.item);
  if (collectionId) {
    await moveItemToCollection(built.item.id, collectionId);
  }
  return { item: built.item };
}
