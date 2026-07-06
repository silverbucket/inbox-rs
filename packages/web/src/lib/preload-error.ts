/**
 * Recover from deploy-invalidated lazy chunks.
 *
 * The app is a PWA registered with `autoUpdate`: a tab left open across a
 * release keeps running the old shell, but the new service worker purges the
 * old hashed chunks from the precache (and the deploy removes them from the
 * server). The next dynamic import — e.g. clicking a card, which lazy-loads
 * ViewCardModal — then 404s. Vite surfaces exactly that failure as a
 * `vite:preloadError` event; reloading fetches the fresh shell whose chunks
 * all exist.
 *
 * A reload is only attempted once per RELOAD_WINDOW_MS (tracked in
 * sessionStorage so it survives the reload itself). If the failure persists —
 * assets genuinely unreachable — the error propagates to the import() caller
 * instead of reload-looping.
 */

const STORAGE_KEY = 'inbox-rs:preload-error-reload';
const RELOAD_WINDOW_MS = 60_000;

export function installPreloadErrorReload(
  reload: () => void = () => window.location.reload(),
  now: () => number = Date.now,
): () => void {
  const onPreloadError = () => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(STORAGE_KEY) ?? 0);
    } catch {
      // Storage blocked (private mode etc.) — we can't guard against a
      // reload loop, so don't auto-reload; the caller's catch handles it.
      return;
    }
    if (now() - last < RELOAD_WINDOW_MS) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, String(now()));
    } catch {
      return;
    }
    reload();
  };
  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
}
