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
