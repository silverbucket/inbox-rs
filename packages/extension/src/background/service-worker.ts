import type { BookmarkItem, ImageItem, NoteItem } from '@inbox-rs/rs-module';
import browser from 'webextension-polyfill';
import { DirectRS } from '../lib/rs';
import { getConfig } from '../lib/storage';

// Register context menus on install
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: 'save-link',
    title: 'Save link to Inbox',
    contexts: ['link'],
  });

  browser.contextMenus.create({
    id: 'save-image',
    title: 'Save image to Inbox',
    contexts: ['image'],
  });

  browser.contextMenus.create({
    id: 'save-selection',
    title: 'Save to Inbox',
    contexts: ['selection'],
  });
});

/** Max size for images fetched via the extension (25 MiB). */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Hard timeout for image fetches (network can be slow on some RS servers). */
const FETCH_TIMEOUT_MS = 20_000;

/** Download an image and return the binary data + detected mime type.
 *  Applies size and timeout limits to avoid DoS / excessive memory use in the
 *  service worker (which has <all_urls> and is triggered by context menus or
 *  the popup on arbitrary pages).
 */
async function fetchImageData(
  url: string,
): Promise<{ data: ArrayBuffer; mimeType: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;

    // Enforce size limit using Content-Length when present (cheap early exit).
    // Require the entire (trimmed) header value to be pure digits to avoid
    // partial parses like "123abc" or "20MB" bypassing the early guard.
    const len = resp.headers.get('content-length')?.trim();
    const contentLength = len && /^\d+$/.test(len) ? Number(len) : NaN;
    if (!Number.isNaN(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      return null;
    }

    const mimeType =
      resp.headers.get('content-type')?.split(';')[0] || 'image/png';

    // Guard against non-image responses from weird servers / redirects.
    if (!mimeType.startsWith('image/')) {
      return null;
    }

    const data = await resp.arrayBuffer();
    if (data.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }

    return { data, mimeType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Get file extension from mime type */
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };
  return map[mime] || 'png';
}

/** Get page metadata via content script */
async function getPageMetadata(tabId: number) {
  try {
    return await browser.tabs.sendMessage(tabId, { type: 'get-metadata' });
  } catch {
    return null;
  }
}

// Handle context menu clicks
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  const config = await getConfig();
  if (!config?.token || !config?.href) return;

  const rs = new DirectRS(config);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  if (info.menuItemId === 'save-link' && info.linkUrl) {
    // Try to get metadata from the link target page if possible
    const item: BookmarkItem = {
      id,
      type: 'bookmark',
      title: info.linkText || info.linkUrl,
      url: info.linkUrl,
      createdAt,
    };
    await rs.store(item);
  } else if (info.menuItemId === 'save-image' && info.srcUrl) {
    const imageData = await fetchImageData(info.srcUrl);
    if (imageData) {
      const ext = extFromMime(imageData.mimeType);
      const filePath = `files/${id}.${ext}`;
      const item: ImageItem = {
        id,
        type: 'image',
        title: tab?.title ? `Image from ${tab.title}` : 'Saved image',
        filePath,
        mimeType: imageData.mimeType,
        sourceUrl: info.srcUrl,
        createdAt,
      };
      if (info.pageUrl) {
        item.description = `Source page: ${info.pageUrl}`;
      }
      await rs.store(item, imageData.data);
    }
  } else if (info.menuItemId === 'save-selection' && info.selectionText) {
    // Get page metadata for context
    let pageTitle = '';
    let pageUrl = '';
    if (tab?.id) {
      const meta = await getPageMetadata(tab.id);
      if (meta) pageTitle = meta.title;
    }
    pageTitle = pageTitle || tab?.title || '';
    pageUrl = tab?.url || '';

    const item: NoteItem = {
      id,
      type: 'note',
      title: pageTitle ? `From: ${pageTitle}` : 'Selection',
      body: info.selectionText,
      createdAt,
      ...(pageUrl ? { description: `Source: ${pageUrl}` } : {}),
    };
    await rs.store(item);
  }
});

// Listen for messages from popup
browser.runtime.onMessage.addListener(async (msg, _sender) => {
  if (msg.type === 'fetch-metadata' && msg.tabId) {
    return getPageMetadata(msg.tabId);
  }
  // Download an image and store it directly to RS (avoids large binary message passing)
  if (msg.type === 'download-and-store-image' && msg.url && msg.filePath) {
    const config = await getConfig();
    if (!config?.token || !config?.href) return { ok: false };
    const imageData = await fetchImageData(msg.url);
    if (!imageData) return { ok: false };
    const rs = new DirectRS(config);
    try {
      await rs.storeFile(msg.filePath, imageData.data, imageData.mimeType);
      return { ok: true, mimeType: imageData.mimeType };
    } catch {
      return { ok: false };
    }
  }
});
