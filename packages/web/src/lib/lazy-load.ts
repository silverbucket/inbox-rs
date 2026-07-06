import { showToast } from './toast';

/**
 * Load a lazy (dynamic-imported) component, tolerating a failed chunk fetch.
 *
 * A failure (stale tab after a deploy, flaky network) must never leave the
 * summoning state dangling — e.g. a modal "open" with no UI — so callers pass
 * `onerror` to undo that state; the user gets a toast either way. Callers
 * assign with `??=`, so a `null` return leaves the cache empty and the next
 * attempt retries the import. In production a deploy-invalidated chunk also
 * triggers a one-shot reload via vite:preloadError (see main.ts); this catch
 * covers the rest.
 */
export async function loadLazy<T>(
  importer: () => Promise<{ default: unknown }>,
  onerror?: () => void,
): Promise<T | null> {
  try {
    return (await importer()).default as T;
  } catch (error) {
    console.error('Failed to load lazy component', error);
    onerror?.();
    showToast("Couldn't load that view — reload the app and try again.");
    return null;
  }
}
