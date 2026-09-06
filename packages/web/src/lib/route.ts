/**
 * Hash-based route parsing and formatting.
 *
 * URL shape lives entirely inside the hash (`window.location.hash`), so a
 * typical URL looks like:
 *   https://example.com/#/todos?g=workId,personalId
 *
 * Pages: inbox (default), todos, collections, plugins, search, and
 * collection (focus mode for one collection: `#/collection/:id`).
 * Query params:
 *   g  — comma-separated group IDs for filter state. Only meaningful on
 *        the `todos` and `collections` pages; ignored elsewhere.
 *   q  — search text. Only meaningful on the `search` page.
 */

export type Page =
  | 'inbox'
  | 'todos'
  | 'collections'
  | 'plugins'
  | 'search'
  | 'collection';

export interface Route {
  page: Page;
  /** Group filter IDs parsed from the `g=` param. undefined = not supplied. */
  groupFilters?: string[];
  /** Focused collection id. Only set when `page` is `collection`. */
  collectionId?: string;
  /** Search text from the `q=` param. Only set when `page` is `search`. */
  query?: string;
}

/**
 * Parse a hash string (with or without leading '#') into a Route.
 * Unknown paths fall back to the `inbox` page.
 */
export function parseHash(hash: string): Route {
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (h.startsWith('/')) h = h.slice(1);
  // Split path and query
  const qIdx = h.indexOf('?');
  const path = qIdx >= 0 ? h.slice(0, qIdx) : h;
  const query = qIdx >= 0 ? h.slice(qIdx + 1) : '';

  const clean = path.replace(/\/+$/, '');
  if (clean.startsWith('collection/')) {
    try {
      const id = decodeURIComponent(clean.slice('collection/'.length));
      // Focus mode carries no filter params — the whole point is one
      // collection, so `g=` is dropped rather than remembered.
      if (id) return { page: 'collection', collectionId: id };
    } catch {
      // Malformed percent-encoding (e.g. #/collection/%) — treat like any
      // other unknown path rather than letting URIError break routing.
    }
  }

  const page = pageFromPath(clean);
  if (page === 'search') {
    // Search carries its text and nothing else — group filters don't apply,
    // results span every collection.
    const q = parseQueryText(query);
    return q ? { page, query: q } : { page };
  }
  const groupFilters = parseQueryGroups(query);
  return groupFilters === undefined ? { page } : { page, groupFilters };
}

function pageFromPath(clean: string): Page {
  switch (clean) {
    case '':
    case 'inbox':
      return 'inbox';
    case 'todos':
      return 'todos';
    case 'collections':
      return 'collections';
    case 'plugins':
      return 'plugins';
    case 'search':
      return 'search';
    default:
      // Legacy: #/group/:id and #/collections (ungrouped) both redirect
      // to the new Collections page. Filter params are not preserved.
      if (clean.startsWith('group/')) return 'collections';
      return 'inbox';
  }
}

function parseQueryGroups(query: string): string[] | undefined {
  if (!query) return undefined;
  const params = new URLSearchParams(query);
  const raw = params.get('g');
  if (raw === null) return undefined;
  if (raw === '') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseQueryText(query: string): string {
  // URLSearchParams tolerates malformed percent-encoding (it never throws),
  // so a hand-mangled link degrades to odd text rather than a routing error.
  return query ? (new URLSearchParams(query).get('q') ?? '') : '';
}

/**
 * Format a Route back to a hash string (with leading `#`).
 * Filter params are only emitted on pages that use them.
 */
export function formatRoute(route: Route): string {
  if (route.page === 'collection') {
    // A collection route without an id has nowhere to point; the closest
    // sensible destination is the Collections page.
    return route.collectionId
      ? `#/collection/${encodeURIComponent(route.collectionId)}`
      : '#/collections';
  }
  if (route.page === 'search') {
    // URLSearchParams encodes spaces as `+`, which reads better in a shared
    // link than `%20` and round-trips through `parseQueryText`.
    return route.query
      ? `#/search?${new URLSearchParams({ q: route.query })}`
      : '#/search';
  }
  const path = pathFromPage(route.page);
  if (!pageUsesFilters(route.page) || route.groupFilters === undefined) {
    return `#${path}`;
  }
  if (route.groupFilters.length === 0) {
    return `#${path}?g=`;
  }
  return `#${path}?g=${route.groupFilters.join(',')}`;
}

function pathFromPage(page: Exclude<Page, 'collection' | 'search'>): string {
  switch (page) {
    case 'inbox':
      return '/';
    case 'todos':
      return '/todos';
    case 'collections':
      return '/collections';
    case 'plugins':
      return '/plugins';
  }
}

export function pageUsesFilters(page: Page): boolean {
  return page === 'todos' || page === 'collections';
}
