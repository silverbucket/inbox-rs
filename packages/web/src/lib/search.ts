import type { Collection, InboxItem } from '@inbox-rs/rs-module';

/**
 * In-memory search over every item the app holds — inbox cards, filed
 * references, todos (open, completed, archived) alike. The whole store is
 * already in memory, so there is no index to maintain: each query is one
 * pass over the items, scored per term.
 *
 * Query grammar is deliberately small: whitespace-separated terms, all of
 * which must match somewhere on the item (AND), plus "quoted phrases" that
 * must match verbatim. Matching is case- and accent-insensitive, so `cafe`
 * finds `Café` and vice versa.
 */

export interface SearchResult {
  item: InboxItem;
  /** Higher is a better match. Only meaningful relative to other results. */
  score: number;
}

/**
 * Lowercase, strip combining marks so accents don't split matches, and
 * collapse whitespace runs so a quoted phrase matches across a line break.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Split a query into normalized terms. Double-quoted runs stay together as
 * one term; an unbalanced quote is dropped and the rest searched as words.
 */
export function parseQuery(query: string): string[] {
  const terms: string[] = [];
  for (const match of normalize(query).matchAll(/"([^"]*)"|(\S+)/g)) {
    // Group 1 is a quoted phrase; group 2 a bare token, which may carry an
    // unbalanced quote (`"abc`) — strip it so the letters still match.
    const term = (match[1] ?? match[2].replace(/^"+|"+$/g, '')).trim();
    if (term) terms.push(term);
  }
  return terms;
}

// Field weights. The title is what the user most likely remembers; body-ish
// text is the next best signal; a URL match is real but usually incidental
// (every GitHub bookmark contains "github").
const TITLE_WEIGHT = 3;
const TEXT_WEIGHT = 2;
const URL_WEIGHT = 1;
// A term matching at the start of the title (or of a word in it) is a
// stronger signal than one buried mid-word.
const TITLE_WORD_START_BONUS = 1;

interface SearchFields {
  title: string;
  text: string[];
  url: string[];
}

/**
 * The text a search runs against, per item. Optional fields are folded in
 * when present; the owning collection's name is included so `in: reading`
 * style recall works without dedicated syntax.
 */
export function searchFields(
  item: InboxItem,
  collection?: Collection,
): SearchFields {
  // The union's optional fields differ per variant; a loose record keeps the
  // lookups readable without a per-type switch.
  const r = item as unknown as Record<string, unknown>;
  const str = (key: string): string | undefined =>
    typeof r[key] === 'string' ? (r[key] as string) : undefined;

  const text = [
    item.description,
    str('body'),
    str('notes'),
    str('siteName'),
    str('from'),
    str('fileName'),
    collection?.name,
  ].filter((s): s is string => !!s);
  const url = [str('url'), str('sourceUrl')].filter((s): s is string => !!s);

  return {
    title: normalize(item.title ?? ''),
    text: text.map(normalize),
    url: url.map(normalize),
  };
}

function titleScore(title: string, term: string): number {
  const idx = title.indexOf(term);
  if (idx < 0) return 0;
  const atWordStart = idx === 0 || /[\s\p{P}]/u.test(title[idx - 1]);
  return TITLE_WEIGHT + (atWordStart ? TITLE_WORD_START_BONUS : 0);
}

/**
 * Score one item against already-parsed terms. Returns 0 when any term
 * fails to match — every term must hit at least one field.
 */
export function scoreFields(fields: SearchFields, terms: string[]): number {
  let total = 0;
  for (const term of terms) {
    let best = titleScore(fields.title, term);
    if (best < TITLE_WEIGHT && fields.text.some((t) => t.includes(term))) {
      best = Math.max(best, TEXT_WEIGHT);
    }
    if (best < URL_WEIGHT && fields.url.some((u) => u.includes(term))) {
      best = URL_WEIGHT;
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/**
 * Run a query over `items`. Results are sorted best-first; ties fall back to
 * newest-first so a broad query still reads like the inbox. An empty (or
 * whitespace-only) query yields no results rather than everything — the
 * search page shows its prompt instead.
 */
export function searchItems(
  items: Iterable<InboxItem>,
  query: string,
  collections: Record<string, Collection> = {},
): SearchResult[] {
  return searchItemsWithTerms(items, parseQuery(query), collections);
}

/**
 * `searchItems` for callers that already hold the parsed terms — the search
 * page tokenizes once per keystroke to decide whether to search at all, and
 * reuses that here rather than parsing the same text twice.
 */
export function searchItemsWithTerms(
  items: Iterable<InboxItem>,
  terms: readonly string[],
  collections: Record<string, Collection> = {},
): SearchResult[] {
  if (terms.length === 0) return [];

  const results: SearchResult[] = [];
  for (const item of items) {
    const collection = item.collectionId
      ? collections[item.collectionId]
      : undefined;
    const score = scoreFields(searchFields(item, collection), terms);
    if (score > 0) results.push({ item, score });
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      new Date(b.item.createdAt).getTime() -
        new Date(a.item.createdAt).getTime(),
  );
  return results;
}

/** True for items that belong on a todo list rather than in the card grid. */
export function isTodoLike(item: InboxItem): boolean {
  return !!item.isTodo || item.type === 'todo';
}
