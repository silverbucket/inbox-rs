/**
 * Hash-based route parsing and formatting.
 *
 * URL shape lives entirely inside the hash (`window.location.hash`), so a
 * typical URL looks like:
 *   https://example.com/#/todos?g=workId,personalId
 *
 * Pages: inbox (default), todos, collections, plugins.
 * Query params:
 *   g  — comma-separated group IDs for filter state. Only meaningful on
 *        the `todos` and `collections` pages; ignored elsewhere.
 */

export type Page = 'inbox' | 'todos' | 'collections' | 'plugins';

export interface Route {
  page: Page;
  /** Group filter IDs parsed from the `g=` param. undefined = not supplied. */
  groupFilters?: string[];
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

  const page = pageFromPath(path);
  const groupFilters = parseQueryGroups(query);
  return groupFilters === undefined ? { page } : { page, groupFilters };
}

function pageFromPath(path: string): Page {
  const clean = path.replace(/\/+$/, '');
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

/**
 * Format a Route back to a hash string (with leading `#`).
 * Filter params are only emitted on pages that use them.
 */
export function formatRoute(route: Route): string {
  const path = pathFromPage(route.page);
  if (!pageUsesFilters(route.page) || route.groupFilters === undefined) {
    return `#${path}`;
  }
  if (route.groupFilters.length === 0) {
    return `#${path}?g=`;
  }
  return `#${path}?g=${route.groupFilters.join(',')}`;
}

function pathFromPage(page: Page): string {
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

/**
 * Update the URL hash without adding a browser history entry.
 * Used when filter pills change so toggling filters does not spam history.
 */
export function replaceRouteHash(hash: string): void {
  if (window.location.hash !== hash) {
    window.history.replaceState(null, '', hash);
  }
}
