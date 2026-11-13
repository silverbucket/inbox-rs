/**
 * Previews for web links written in an item's text.
 *
 * A web address alone on its own line (how a pasted link usually lands)
 * gets a card under it with the page's title, description and image. The
 * details come from Sockethub's `metadata` platform, the same service that
 * fills in saved links (see enrich.ts), and follow the same setting.
 *
 * Fetched details are kept in this browser only, so reopening a note does
 * not ask the service again. Nothing is written to the item.
 */

import { linkPreviewsEnabled, resolveSockethubEndpoint } from './enrich';
import { fetchLinkMetadata } from './link-metadata';

export interface LinkPreview {
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

export const LINK_PREVIEW_CACHE_KEY = 'inbox-rs:link-preview-cache';
/** How many previews one piece of text shows; further links stay plain. */
export const MAX_LINK_PREVIEWS = 8;

const CACHE_MAX_ENTRIES = 150;
const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NOTHING_TTL_MS = 24 * 60 * 60 * 1000;
const DESCRIPTION_MAX = 240;

/** `p` is the preview, or null when the page offered nothing to show. */
type CacheEntry = { t: number; p: LinkPreview | null };
type Cache = Record<string, CacheEntry>;

function readCache(): Cache {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(LINK_PREVIEW_CACHE_KEY) ?? '{}',
    );
    return parsed && typeof parsed === 'object' ? (parsed as Cache) : {};
  } catch {
    return {};
  }
}

function writeCache(url: string, preview: LinkPreview | null) {
  try {
    const cache = readCache();
    cache[url] = { t: Date.now(), p: preview };
    const urls = Object.keys(cache);
    if (urls.length > CACHE_MAX_ENTRIES) {
      urls
        .sort((a, b) => cache[a].t - cache[b].t)
        .slice(0, urls.length - CACHE_MAX_ENTRIES)
        .forEach((old) => {
          delete cache[old];
        });
    }
    localStorage.setItem(LINK_PREVIEW_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // No storage (private mode, quota): previews still work, uncached.
  }
}

/**
 * The preview already known for this address: a preview, null when there is
 * none to show (the page offers none, or previews are turned off), or
 * undefined when it has not been fetched lately.
 */
export function cachedLinkPreview(url: string): LinkPreview | null | undefined {
  // Off means off: a preview fetched earlier is not shown either, so no
  // image is loaded from the linked site.
  if (!linkPreviewsEnabled()) return null;
  const entry = readCache()[url];
  if (!entry || typeof entry.t !== 'number') return undefined;
  const ttl = entry.p ? FOUND_TTL_MS : NOTHING_TTL_MS;
  return Date.now() - entry.t < ttl ? entry.p : undefined;
}

/**
 * The address when `text` is nothing but one http(s) link, optionally in
 * markdown's `<…>` form; null otherwise. Addresses that carry a username
 * or password are left alone, so credentials never reach the service.
 */
export function standaloneUrl(text: string | null | undefined): string | null {
  const match = /^<?(https?:\/\/[^\s<>]+)>?$/i.exec((text ?? '').trim());
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    return url.hostname && !url.username && !url.password ? match[1] : null;
  } catch {
    return null;
  }
}

/** The site's name for display: `www.example.com` reads as `example.com`. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const inFlight = new Map<string, Promise<LinkPreview | null>>();

/**
 * Fetch the preview for a link, once per address. Resolves to null when
 * previews are off, the browser is offline, the service fails, or the page
 * has no title to show. Never rejects.
 */
export function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  const cached = cachedLinkPreview(url);
  if (cached !== undefined) return Promise.resolve(cached);
  if (!linkPreviewsEnabled() || !navigator.onLine) return Promise.resolve(null);

  let pending = inFlight.get(url);
  if (!pending) {
    // The part after `#` never reaches a server; keep it from this one too.
    const target = url.replace(/#.*$/, '');
    pending = fetchLinkMetadata(target, resolveSockethubEndpoint()).then(
      (metadata) => {
        const preview: LinkPreview | null = metadata?.title
          ? {
              title: metadata.title,
              description:
                metadata.description &&
                metadata.description.length > DESCRIPTION_MAX
                  ? `${metadata.description.slice(0, DESCRIPTION_MAX)}…`
                  : metadata.description,
              image: metadata.image,
              siteName: metadata.siteName,
              favicon: metadata.favicon,
            }
          : null;
        writeCache(url, preview);
        return preview;
      },
      // A failed fetch is not remembered beyond this page load, so the
      // link is tried again next time rather than left without a preview.
      () => null,
    );
    inFlight.set(url, pending);
  }
  return pending;
}

function span(className: string, text?: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

/** An image that removes itself when it fails to load. */
function image(className: string, src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => img.remove());
  img.src = src;
  return img;
}

/**
 * The preview card for a link: a link itself, opening the page in a new
 * tab. Built from spans so it is valid inside a paragraph.
 */
export function buildLinkPreviewCard(
  url: string,
  preview: LinkPreview,
): HTMLAnchorElement {
  const card = document.createElement('a');
  card.className = 'link-preview';
  card.href = url;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  card.title = url;

  const text = span('link-preview-text');
  const site = span('link-preview-site');
  if (preview.favicon) {
    site.append(image('link-preview-favicon', preview.favicon));
  }
  site.append(span('link-preview-host', preview.siteName || linkHost(url)));
  text.append(site, span('link-preview-title', preview.title));
  if (preview.description) {
    text.append(span('link-preview-desc', preview.description));
  }
  card.append(text);
  if (preview.image) {
    card.append(image('link-preview-image', preview.image));
  }
  return card;
}

/** Skips whitespace-only text between a link and its neighbours. */
function neighbour(node: Node, direction: 'previous' | 'next'): Node | null {
  let current = direction === 'next' ? node.nextSibling : node.previousSibling;
  while (
    current &&
    ((current.nodeType === Node.TEXT_NODE && !current.textContent?.trim()) ||
      (current instanceof Element &&
        current.classList.contains('link-preview')))
  ) {
    current =
      direction === 'next' ? current.nextSibling : current.previousSibling;
  }
  return current;
}

const isLineEdge = (node: Node | null) =>
  node === null || node.nodeName === 'BR';

/**
 * The address of a rendered link that stands alone on its line in a
 * top-level paragraph of `root`, shown as the address itself; else null.
 */
function standaloneLinkUrl(root: HTMLElement, link: HTMLAnchorElement) {
  const paragraph = link.parentElement;
  if (paragraph?.tagName !== 'P' || paragraph.parentElement !== root) {
    return null;
  }
  if (!isLineEdge(neighbour(link, 'previous'))) return null;
  if (!isLineEdge(neighbour(link, 'next'))) return null;
  return standaloneUrl(link.textContent);
}

/**
 * Svelte action for a container of rendered markdown: every web link that
 * stands alone on its line is replaced by its preview card once the
 * details arrive. A link with no preview stays as it is. Pass `false` to
 * leave the links alone (the setting is read once, when mounted).
 */
export function linkPreviews(node: HTMLElement, enabled = true) {
  if (!enabled) return {};
  const seen = new WeakSet<Element>();
  let alive = true;

  const update = () => {
    let shown = node.querySelectorAll('a[data-link-preview]').length;
    for (const link of node.querySelectorAll<HTMLAnchorElement>(
      'a[href]:not(.item-link):not(.link-preview)',
    )) {
      if (seen.has(link)) continue;
      if (shown >= MAX_LINK_PREVIEWS) break;
      const url = standaloneLinkUrl(node, link);
      if (!url) continue;
      seen.add(link);
      link.dataset.linkPreview = 'pending';
      shown++;
      void loadLinkPreview(url).then((preview) => {
        if (!alive || !link.isConnected) return;
        if (!preview) {
          link.dataset.linkPreview = 'none';
          return;
        }
        link.dataset.linkPreview = 'shown';
        link.after(buildLinkPreviewCard(url, preview));
      });
    }
  };

  const observer = new MutationObserver(update);
  observer.observe(node, { childList: true, subtree: true });
  update();
  return {
    destroy() {
      alive = false;
      observer.disconnect();
    },
  };
}
