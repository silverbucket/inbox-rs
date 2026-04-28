import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `lib/storage.ts` is a thin wrapper around `createConfigStore()` from
 * `@inbox-rs/rs-module`. The wrapper itself doesn't have logic — it just
 * binds the store to `browser.storage.local`. These tests pin the wiring
 * so an accidental change (wrong storage area, wrong key, missing await)
 * is caught immediately.
 */

const { mockStorage, mockGet, mockSet, mockRemove } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockSet = vi.fn();
  const mockRemove = vi.fn();
  return {
    mockGet,
    mockSet,
    mockRemove,
    mockStorage: {
      local: { get: mockGet, set: mockSet, remove: mockRemove },
    },
  };
});

vi.mock('webextension-polyfill', () => ({
  default: { storage: mockStorage },
}));

import { getConfig, saveConfig, clearConfig } from './storage';
import type { RSConfig } from '@inbox-rs/rs-module';

const sampleConfig: RSConfig = {
  userAddress: 'alice@example.com',
  token: 'tok-abc',
  href: 'https://storage.example.com/storage/alice',
  storageApi: 'draft-dejong-remotestorage-12',
};

describe('storage wrapper', () => {
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

    it('returns null when no config has been saved', async () => {
      mockGet.mockResolvedValue({});

      expect(await getConfig()).toBeNull();
    });

    it('returns null when the stored value is undefined (e.g. partial clear)', async () => {
      mockGet.mockResolvedValue({ 'inbox-rs-config': undefined });

      expect(await getConfig()).toBeNull();
    });
  });

  describe('saveConfig', () => {
    it('writes to browser.storage.local under the canonical key', async () => {
      await saveConfig(sampleConfig);

      expect(mockSet).toHaveBeenCalledWith({ 'inbox-rs-config': sampleConfig });
    });

    it('round-trips with getConfig', async () => {
      // Simulate a real storage area with a Map.
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

    it('makes getConfig return null afterwards', async () => {
      const store = new Map<string, unknown>([
        ['inbox-rs-config', sampleConfig],
      ]);
      mockGet.mockImplementation(async (key: string) => {
        const out: Record<string, unknown> = {};
        if (store.has(key)) out[key] = store.get(key);
        return out;
      });
      mockRemove.mockImplementation(async (key: string) => {
        store.delete(key);
      });

      await clearConfig();
      expect(await getConfig()).toBeNull();
    });
  });
});
