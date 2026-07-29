import type { Collection, InboxItem } from '@inbox-rs/rs-module';

/**
 * Collection-filing suggestions for the card view's picker.
 *
 * Two signals, blended in a fixed priority order (no ML, no fuzziness — the
 * picker shows a "why" tag per suggestion, so every entry must be explainable
 * in two words):
 *
 *   1. Content match — the item's site domain already appears among a
 *      collection's bookmarks ("matches site"), or the collection's name
 *      occurs in the item's title/description ("matches name").
 *   2. Recency — collections the user filed into recently on this device
 *      ("recent"). Stored in localStorage: filing habits are per-device
 *      ephemera, not user data worth syncing through remoteStorage.
 */

export type SuggestionReason = 'site' | 'name' | 'recent';

export interface CollectionSuggestion {
  collection: Collection;
  reason: SuggestionReason;
}

const RECENT_KEY = 'inbox-rs:recent-collections';
const RECENT_MAX = 12;
export const SUGGESTION_MAX = 3;

/** Most-recently-used collection ids, newest first. */
export function getRecentCollectionIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Record a filing target so future pickers can suggest it. */
export function recordCollectionUse(collectionId: string): void {
  try {
    const next = [
      collectionId,
      ...getRecentCollectionIds().filter((id) => id !== collectionId),
    ].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota) — suggestions just lose the
    // recency signal; filing itself is unaffected.
  }
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function itemDomain(item: InboxItem): string | null {
  return 'url' in item && typeof item.url === 'string'
    ? domainOf(item.url)
    : null;
}

/**
 * Does `name` occur in `text` as a whole word/phrase? Guards against 1–2
 * character collection names ("Go", "JS" are fine; "a" would match
 * everything, so require length >= 2).
 */
function nameMatches(name: string, text: string): boolean {
  const needle = name.trim().toLowerCase();
  if (needle.length < 2) return false;
  const haystack = text.toLowerCase();
  const idx = haystack.indexOf(needle);
  if (idx === -1) return false;
  const before = haystack[idx - 1];
  const after = haystack[idx + needle.length];
  const isBoundary = (ch: string | undefined) =>
    ch === undefined || !/[a-z0-9]/.test(ch);
  return isBoundary(before) && isBoundary(after);
}

/**
 * Rank collections worth surfacing for `item`.
 *
 * Pure — recency arrives as an argument so tests never touch localStorage.
 * The item's current collection is never suggested (moving a card to where
 * it already lives is a no-op).
 */
export function suggestCollections(
  item: InboxItem,
  collections: Collection[],
  allItems: Record<string, InboxItem>,
  recentIds: string[],
  max: number = SUGGESTION_MAX,
): CollectionSuggestion[] {
  const out: CollectionSuggestion[] = [];
  const seen = new Set<string>();
  const add = (collection: Collection, reason: SuggestionReason) => {
    if (collection.id === item.collectionId) return;
    if (seen.has(collection.id)) return;
    seen.add(collection.id);
    out.push({ collection, reason });
  };

  // 1a. Site match — strongest signal: the user already files this domain here.
  const domain = itemDomain(item);
  if (domain) {
    for (const col of collections) {
      const hasDomain = col.itemIds.some((id) => {
        const other = allItems[id];
        return other && other.id !== item.id && itemDomain(other) === domain;
      });
      if (hasDomain) add(col, 'site');
    }
  }

  // 1b. Name match against the item's own words.
  const text = `${item.title} ${item.description ?? ''}`;
  for (const col of collections) {
    if (nameMatches(col.name, text)) add(col, 'name');
  }

  // 2. Recency fills the remaining slots, newest first.
  const byId = new Map(collections.map((c) => [c.id, c]));
  for (const id of recentIds) {
    const col = byId.get(id);
    if (col) add(col, 'recent');
  }

  return out.slice(0, max);
}
