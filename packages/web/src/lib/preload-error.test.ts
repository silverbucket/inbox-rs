// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPreloadErrorReload } from './preload-error';

function firePreloadError() {
  window.dispatchEvent(new Event('vite:preloadError'));
}

describe('installPreloadErrorReload', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    sessionStorage.clear();
  });

  it('reloads on the first preload error, then guards against a loop', () => {
    const reload = vi.fn();
    let t = 1_000_000;
    uninstall = installPreloadErrorReload(reload, () => t);

    firePreloadError();
    expect(reload).toHaveBeenCalledTimes(1);

    // Within the guard window: no second reload (would loop).
    t += 30_000;
    firePreloadError();
    expect(reload).toHaveBeenCalledTimes(1);

    // Past the window a fresh failure may reload again.
    t += 60_000;
    firePreloadError();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload again right after a guard-stamped reload (sessionStorage persists across reloads)', () => {
    const reload = vi.fn();
    const t = 2_000_000;
    // Simulate the state just after a preload-error reload: the previous page
    // load stamped the timestamp before reloading.
    sessionStorage.setItem('inbox-rs:preload-error-reload', String(t - 1_000));
    uninstall = installPreloadErrorReload(reload, () => t);

    firePreloadError();
    expect(reload).not.toHaveBeenCalled();
  });
});
