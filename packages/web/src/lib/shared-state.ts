const STORAGE_KEY = 'inbox-rs-shared';

export function getSharedMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

export function getSharedUrl(key: string): string | undefined {
  return getSharedMap()[key];
}

export function saveSharedUrl(key: string, url: string): void {
  try {
    const map = getSharedMap();
    map[key] = url;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage quota exceeded or disabled — non-fatal
  }
}

export function removeSharedUrl(key: string): void {
  try {
    const map = getSharedMap();
    delete map[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // non-fatal
  }
}

/**
 * HEAD-check a stored sharesome URL. Returns true if still live, false if stale.
 * On stale (404/network error), removes the entry from localStorage.
 */
export async function verifySharedUrl(key: string): Promise<boolean> {
  const url = getSharedUrl(key);
  if (!url) return false;
  try {
    const resp = await fetch(url, { method: 'HEAD', mode: 'cors' });
    if (resp.ok) return true;
    removeSharedUrl(key);
    return false;
  } catch {
    // Network error or CORS block — assume stale
    removeSharedUrl(key);
    return false;
  }
}
