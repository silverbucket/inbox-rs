import type { BookmarkItem, ImageItem } from '@inbox-rs/rs-module';
import { get } from 'svelte/store';
import { buildImageItem } from './build-item';
import { downloadDirectImage } from './direct-image';
import { items, storeItem } from './stores';

/** Convert a bookmark whose response is an image while retaining its identity
 * and user-authored metadata. Returns false when the URL is not an image or
 * the bookmark changed while the download was in flight. */
export async function convertBookmarkToImage(
  item: BookmarkItem,
): Promise<boolean> {
  // Only probe URLs whose path looks like an image. Probing every ordinary
  // page from the browser produces unavoidable CORS errors in Chrome; the
  // normal Sockethub metadata path handles those bookmarks instead.
  const file = await downloadDirectImage(item.url);
  if (!file) return false;

  const current = get(items)[item.id];
  if (!current || current.type !== 'bookmark' || current.url !== item.url) {
    return false;
  }

  const built = await buildImageItem(
    { id: current.id, createdAt: current.createdAt, editItem: current },
    {
      title: current.title === current.url ? file.name : current.title,
      description: current.description || '',
      file,
    },
  );
  if (!built || built.item.type !== 'image') return false;

  const converted: ImageItem = {
    ...current,
    ...built.item,
    type: 'image',
    sourceUrl: current.url,
    body: current.body,
  };
  const bookmarkFields = converted as unknown as Record<string, unknown>;
  delete bookmarkFields.url;
  delete bookmarkFields.favicon;
  delete bookmarkFields.ogImage;
  delete bookmarkFields.siteName;

  await storeItem(converted, built.fileData, built.thumbData);
  return true;
}
