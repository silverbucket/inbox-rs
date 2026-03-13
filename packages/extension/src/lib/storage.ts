import browser from 'webextension-polyfill';

const STORAGE_KEY = 'inbox-rs-config';

export interface RSConfig {
  userAddress: string;
  token?: string;
  href?: string;
  storageApi?: string;
}

export async function getConfig(): Promise<RSConfig | null> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || null;
}

export async function saveConfig(config: RSConfig): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: config });
}

export async function clearConfig(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
}
