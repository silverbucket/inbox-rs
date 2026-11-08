import {
  applySchedule,
  type BookmarkItem,
  eventSchedule,
  type ImageItem,
  isPlaceholderImage,
  type LinkEvent,
} from '@inbox-rs/rs-module';
import browser from 'webextension-polyfill';
import type { DirectRS } from '../lib/rs';
import { recognisableTitle } from '../lib/title';

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

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
export function isDirectImagePage(
  contentType: string | undefined,
  url: string,
): boolean {
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
export async function saveAsImage(
  params: SaveImageParams,
): Promise<ImageItem | null> {
  const { rs, id, pageUrl, pageTitle, pageNote, createdAt } = params;
  const guessedExt =
    pageUrl.match(/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)/i)?.[1] ||
    'jpg';
  const filePath = `files/${id}.${guessedExt}`;

  const result = await browser.runtime.sendMessage({
    type: 'download-and-store-image',
    url: pageUrl,
    filePath,
  });

  if (!result?.ok) return null;

  const item: ImageItem = {
    id,
    type: 'image',
    title: pageTitle || pageUrl.split('/').pop() || 'Saved image',
    filePath,
    mimeType:
      result.mimeType || EXT_TO_MIME[guessedExt.toLowerCase()] || 'image/jpeg',
    sourceUrl: pageUrl,
    createdAt,
    ...(pageNote ? { description: pageNote } : {}),
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
  /** The page's declared event, from the fetched link metadata. */
  event?: LinkEvent;
  createdAt: string;
}

/** Save the current page as a BookmarkItem (for normal pages) */
export async function saveAsBookmark(
  params: SavePageParams,
): Promise<BookmarkItem> {
  const {
    rs,
    id,
    pageUrl,
    pageTitle,
    pageNote,
    pageDescription,
    embeddedContent,
    tweetImages,
    ogImage,
    favicon,
    siteName,
    event,
    createdAt,
  } = params;

  // The user's note goes in `body` (the web app's bookmark "Notes" field);
  // `description` stays the page's own. Embedded content (tweet text,
  // article excerpt) follows the note as a blockquote so the two stay distinct.
  const note = pageNote.trim();
  const body =
    note && embeddedContent
      ? `${note}\n\n${quote(embeddedContent)}`
      : note || embeddedContent;

  // Download + store image via service worker.
  // For tweets: only save actual tweet images, not the generic Twitter og:image.
  // For other sites: save the og:image.
  const pageHost = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const isTweetPage = pageHost === 'twitter.com' || pageHost === 'x.com';
  // A generic share card (Reddit's share.redd.it, Amazon's share icon) is
  // not the page's image: neither keep a copy nor link it.
  const isUsefulOgImage = !!ogImage && !isPlaceholderImage(ogImage);
  const imageToSave = isTweetPage
    ? tweetImages[0] || ''
    : isUsefulOgImage
      ? ogImage
      : '';
  let filePath: string | undefined;
  let mimeType: string | undefined;

  if (imageToSave) {
    const guessedExt =
      imageToSave.match(/\.(png|jpg|jpeg|gif|webp|avif)/i)?.[1] || 'jpg';
    const candidatePath = `files/${id}.${guessedExt}`;
    try {
      const result = await browser.runtime.sendMessage({
        type: 'download-and-store-image',
        url: imageToSave,
        filePath: candidatePath,
      });
      if (result?.ok) {
        filePath = candidatePath;
        mimeType =
          result.mimeType ||
          EXT_TO_MIME[guessedExt.toLowerCase()] ||
          'image/jpeg';
      }
    } catch {
      // Image save failed, bookmark will still be saved without local image
    }
  }

  let item: BookmarkItem = {
    id,
    type: 'bookmark',
    title: recognisableTitle(pageUrl, pageTitle),
    url: pageUrl,
    createdAt,
    ...(pageDescription ? { description: pageDescription } : {}),
    ...(body ? { body } : {}),
    ...(filePath ? { filePath, mimeType } : {}),
    ...(isUsefulOgImage ? { ogImage } : {}),
    ...(favicon ? { favicon } : {}),
    ...(siteName ? { siteName } : {}),
  };
  // Same as the web app's applyLinkMetadata: the page's event time (and
  // venue, as `location`) schedules the new bookmark.
  const schedule = event && eventSchedule(event);
  if (schedule) item = applySchedule(item, schedule);
  await rs.store(item);
  return item;
}

/** Markdown blockquote of `text`, every line prefixed. */
function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}
