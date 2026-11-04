import type { RSConfig } from './rs';

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
  return browser.permissions.contains({ origins: [`${origin}/*`] });
}
