import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Thunderbird's `lib/storage.ts` mirrors the Chrome extension wrapper but
 * uses the bare `browser` global (Thunderbird WebExtensions provide it
 * natively, no polyfill import). These tests pin the wiring + the
 * canonical storage key so the same regression class can't slip in.
 */

// `lib/storage.ts` reads the `browser` global at module-load time
// (`createConfigStore(browser.storage.local)`), so the global must exist
// BEFORE any of its imports execute. ES modules hoist imports above any
// top-level statements, so `vi.hoisted()` is the only place we can
// reliably set up the global early enough.
const { mockGet, mockSet, mockRemove } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockSet = vi.fn();
  const mockRemove = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).browser = {
    storage: { local: { get: mockGet, set: mockSet, remove: mockRemove } },
  };
  return { mockGet, mockSet, mockRemove };
});

import type { RSConfig } from '@inbox-rs/rs-module';
import { clearConfig, getConfig, saveConfig } from './storage';

const sampleConfig: RSConfig = {
  userAddress: 'alice@example.com',
  token: 'tok-abc',
  href: 'https://storage.example.com/storage/alice',
  storageApi: 'draft-dejong-remotestorage-12',
};

describe('thunderbird storage wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({});
    mockSet.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
  });

  describe('getConfig', () => {
    it('reads from browser.storage.local under the canonical key', async () => {
      mockGet.mockResolvedValue({ 'inbox-rs-config': sampleConfig });

      const config = await getConfig();

      expect(config).toEqual(sampleConfig);
      expect(mockGet).toHaveBeenCalledWith('inbox-rs-config');
    });

    it('uses the same storage key as the Chrome/Firefox extension', async () => {
      // Cross-platform parity: the key is owned by `@inbox-rs/rs-module`'s
      // `DEFAULT_CONFIG_STORAGE_KEY`. If anyone changes it, both wrappers
      // must move in lockstep — same RS account, two extensions, one key.
      await getConfig();
      expect(mockGet).toHaveBeenCalledWith('inbox-rs-config');
    });

    it('returns null when no config has been saved', async () => {
      mockGet.mockResolvedValue({});
      expect(await getConfig()).toBeNull();
    });
  });

  describe('saveConfig', () => {
    it('writes to browser.storage.local under the canonical key', async () => {
      await saveConfig(sampleConfig);
      expect(mockSet).toHaveBeenCalledWith({ 'inbox-rs-config': sampleConfig });
    });

    it('round-trips with getConfig', async () => {
      const store = new Map<string, unknown>();
      mockGet.mockImplementation(async (key: string) => {
        const out: Record<string, unknown> = {};
        if (store.has(key)) out[key] = store.get(key);
        return out;
      });
      mockSet.mockImplementation(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) store.set(k, v);
      });

      await saveConfig(sampleConfig);
      expect(await getConfig()).toEqual(sampleConfig);
    });
  });

  describe('clearConfig', () => {
    it('removes the canonical key from browser.storage.local', async () => {
      await clearConfig();
      expect(mockRemove).toHaveBeenCalledWith('inbox-rs-config');
    });
  });
});
