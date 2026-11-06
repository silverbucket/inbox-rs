// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTranscriptionAssetCache,
  OFFLINE_TRANSCRIPTION_KEY,
  offlineTranscriptionRetentionEnabled,
  TRANSCRIPTION_ASSETS,
} from './transcription-assets';

describe('offline transcription retention preference', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('is on by default and off only for the literal "false"', () => {
    expect(offlineTranscriptionRetentionEnabled()).toBe(true);
    localStorage.setItem(OFFLINE_TRANSCRIPTION_KEY, 'false');
    expect(offlineTranscriptionRetentionEnabled()).toBe(false);
  });

  it('does not persist on-demand model fetches once the user opted out', async () => {
    localStorage.setItem(OFFLINE_TRANSCRIPTION_KEY, 'false');
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });
    const cache = createTranscriptionAssetCache();
    await cache.put(TRANSCRIPTION_ASSETS[0].url, new Response('x'));
    expect(open).not.toHaveBeenCalled();
  });
});
