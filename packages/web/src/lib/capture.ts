import type { InboxItem } from '@inbox-rs/rs-module';
import { get } from 'svelte/store';
import {
  buildBookmarkItem,
  buildDocumentItem,
  buildImageItem,
  buildNoteItem,
} from './build-item';
import { detectCaptureKind } from './capture-detect';
import { enrichBookmark } from './enrich';
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
  // Fill the bookmark's title/description/preview image from the page's
  // metadata in the background — the capture itself must never wait on
  // (or fail because of) the metadata server.
  if (built.item.type === 'bookmark') {
    void enrichBookmark(built.item).catch(() => {});
  }
  return { item: built.item };
}

/** Build and store a dropped/pasted file directly — the chrome-less counterpart
 *  to the ⊕ picker, which opens the full form. Images become image items,
 *  everything else a document item. An optional caption becomes the title
 *  (the builders fall back to the filename when it's blank). Returns the
 *  created item so the caller can offer Undo. */
export async function captureFile(
  file: File,
  caption = '',
  collectionId?: string,
): Promise<{ item: InboxItem } | null> {
  const ctx = { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  const title = caption.trim();

  // Mirror captureDetected: validate the destination before storing so a
  // missing collection fails up front rather than silently orphaning the item
  // in the Inbox (moveItemToCollection no-ops for a missing collection).
  if (collectionId && !get(collections)[collectionId]) {
    throw new Error('Target collection no longer exists');
  }

  const built = file.type.startsWith('image/')
    ? await buildImageItem(ctx, { title, description: '', file })
    : await buildDocumentItem(ctx, { title, description: '', file });
  // The builders only return null without a file; we always pass one.
  if (!built) return null;

  await storeItem(built.item, built.fileData, built.thumbData);
  if (collectionId) {
    await moveItemToCollection(built.item.id, collectionId);
  }
  return { item: built.item };
}
