import browser from 'webextension-polyfill';
import { DirectRS } from '../lib/rs';
import type { BookmarkItem, ImageItem } from '@inbox-rs/rs-module';

/** Check if a URL points directly to an image file */
export function isImageUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff?)$/.test(pathname);
  } catch {
    return false;
  }
}

/** Determine if the page is a direct image based on contentType and URL */
export function isDirectImagePage(contentType: string | undefined, url: string): boolean {
  if (contentType?.startsWith('image/')) return true;
  return isImageUrl(url);
}

export interface SaveImageParams {
  rs: DirectRS;
  id: string;
  pageUrl: string;
  pageTitle: string;
  pageNote: string;
  createdAt: string;
}

/** Save the current page as an ImageItem (for direct image pages) */
export async function saveAsImage(params: SaveImageParams): Promise<ImageItem | null> {
  const { rs, id, pageUrl, pageTitle, pageNote, createdAt } = params;
  const guessedExt = pageUrl.match(/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)/i)?.[1] || 'jpg';
  const filePath = `files/${id}.${guessedExt}`;

  const result = await browser.runtime.sendMessage({
    type: 'download-and-store-image',
    url: pageUrl,
    filePath
  });

  if (!result?.ok) return null;

  const item: ImageItem = {
    id,
    type: 'image',
    title: pageTitle || pageUrl.split('/').pop() || 'Saved image',
    filePath,
    mimeType: result.mimeType || `image/${guessedExt}`,
    sourceUrl: pageUrl,
    createdAt,
    ...(pageNote ? { description: pageNote } : {})
  };
  await rs.store(item);
  return item;
}

export interface SavePageParams {
  rs: DirectRS;
  id: string;
  pageUrl: string;
  pageTitle: string;
  pageNote: string;
  pageDescription: string;
  embeddedContent: string;
  tweetImages: string[];
  ogImage: string;
  favicon: string;
  siteName: string;
  createdAt: string;
}

/** Save the current page as a BookmarkItem (for normal pages) */
export async function saveAsBookmark(params: SavePageParams): Promise<BookmarkItem> {
  const {
    rs, id, pageUrl, pageTitle, pageNote, pageDescription,
    embeddedContent, tweetImages, ogImage, favicon, siteName, createdAt
  } = params;

  const desc = [pageNote, pageDescription].filter(Boolean).join('\n\n') || undefined;

  // Download + store image via service worker.
  // For tweets: only save actual tweet images, not the generic Twitter og:image.
  // For other sites: save the og:image.
  const isTweetPage = !!embeddedContent || tweetImages.length > 0;
  const imageToSave = isTweetPage ? (tweetImages[0] || '') : (ogImage || '');
  let filePath: string | undefined;
  let mimeType: string | undefined;

  if (imageToSave) {
    const guessedExt = imageToSave.match(/\.(png|jpg|jpeg|gif|webp|avif)/i)?.[1] || 'jpg';
    const candidatePath = `files/${id}.${guessedExt}`;
    try {
      const result = await browser.runtime.sendMessage({
        type: 'download-and-store-image',
        url: imageToSave,
        filePath: candidatePath
      });
      if (result?.ok) {
        filePath = candidatePath;
        mimeType = result.mimeType || `image/${guessedExt}`;
      }
    } catch {
      // Image save failed, bookmark will still be saved without local image
    }
  }

  const isUsefulOgImage = ogImage && !ogImage.includes('/default/') && !ogImage.includes('placeholder');

  const item: BookmarkItem = {
    id, type: 'bookmark', title: pageTitle || pageUrl, url: pageUrl, createdAt,
    ...(desc ? { description: desc } : {}),
    ...(embeddedContent ? { body: embeddedContent } : {}),
    ...(filePath ? { filePath, mimeType } : {}),
    ...(isUsefulOgImage ? { ogImage } : {}),
    ...(favicon ? { favicon } : {}),
    ...(siteName ? { siteName } : {})
  };
  await rs.store(item);
  return item;
}
