import type { RSConfig } from './rs';

const ALL_URLS_PERMISSION = { origins: ['<all_urls>'] };

/**
 * Whether the extension currently holds the `<all_urls>` host permission
 * needed to reach the saved config's storage server. `<all_urls>` is an
 * optional permission (granted during Options connect), and the user can
 * revoke it at any time from Thunderbird's add-on manager — any code about
 * to fetch the storage server must check this first instead of letting the
 * fetch fail with an opaque network error.
 */
export async function hasStorageOriginPermission(
  config: Pick<RSConfig, 'href'> | null | undefined,
): Promise<boolean> {
  if (!config?.href) return false;
  return browser.permissions.contains(ALL_URLS_PERMISSION);
}

/** Requests the `<all_urls>` host permission; resolves to whether it was granted. */
export async function requestAllUrlsPermission(): Promise<boolean> {
  return browser.permissions.request(ALL_URLS_PERMISSION);
}
