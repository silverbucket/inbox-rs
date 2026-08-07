/**
 * Recover from failed lazy-chunk loads.
 *
 * Deploys retain immutable hashed assets and the stable bootloader coordinates
 * service-worker activation, so a normal release must not invalidate a live
 * page. This remains a last-resort guard for a temporarily incomplete CDN
 * publication or manually removed asset. Vite surfaces a failed dynamic import
 * as a `vite:preloadError` event; reloading asks the stable loader to select a
 * complete release or fall back to the last one known to work.
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
