import type { RSConfig } from './rs';

/**
 * Build a WebExtension match pattern for an origin. Gecko match patterns'
 * host segment has no port component (see MDN "Match patterns") — including
 * one produces an invalid pattern, which breaks local dev servers like
 * `http://localhost:8000`. The permission this grants necessarily covers the
 * whole host regardless of port; that's a platform limitation, not something
 * we can narrow.
 */
export function matchPatternForOrigin(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

/**
 * Whether the extension currently holds host permission for the saved
 * config's storage origin. `<all_urls>` is an optional permission (granted
 * during Options connect), and the user can revoke it at any time from
 * Thunderbird's add-on manager — any code about to fetch the storage server
 * must check this first instead of letting the fetch fail with an opaque
 * network error.
 */
export async function hasStorageOriginPermission(
  config: Pick<RSConfig, 'href'> | null | undefined,
): Promise<boolean> {
  if (!config?.href) return false;
  const origin = new URL(config.href).origin;
  return browser.permissions.contains({
    origins: [matchPatternForOrigin(origin)],
  });
}

/** Requests host permission for an origin; resolves to whether it was granted. */
export async function requestOriginPermission(
  origin: string,
): Promise<boolean> {
  return browser.permissions.request({
    origins: [matchPatternForOrigin(origin)],
  });
}
