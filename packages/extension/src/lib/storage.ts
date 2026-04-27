import browser from 'webextension-polyfill';
import { createConfigStore, type RSConfig } from '@inbox-rs/rs-module';

export type { RSConfig };

const store = createConfigStore(browser.storage.local);

export async function getConfig(): Promise<RSConfig | null> {
  return store.get();
}

export async function saveConfig(config: RSConfig): Promise<void> {
  await store.save(config);
}

export async function clearConfig(): Promise<void> {
  await store.clear();
}
