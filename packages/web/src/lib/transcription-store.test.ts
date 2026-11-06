// @vitest-environment jsdom
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const assets = vi.hoisted(() => ({
  downloadTranscriptionAssets: vi.fn(),
  deleteTranscriptionAssets: vi.fn(async () => {}),
  getTranscriptionAssetStatus: vi.fn(async () => ({
    ready: false,
    storedBytes: 0,
    totalBytes: 100,
    storedAssets: 0,
    totalAssets: 1,
  })),
}));

// The store only needs the browser's online flag from stores.ts. Mocking the
// module keeps remoteStorage (and its timers) out of the module graph, which
// matters because the scheduler tests reset modules per case.
vi.mock('./stores', async () => {
  const { writable } = await import('svelte/store');
  return { browserOnline: writable(true) };
});

vi.mock('./transcription-assets', async () => {
  const actual = await vi.importActual<typeof import('./transcription-assets')>(
    './transcription-assets',
  );
  return { ...actual, ...assets };
});

import {
  createDownloadProgressTracker,
  describeTranscriptionError,
} from './transcribe';
import {
  connectionPrefersSavingData,
  shouldAutoDownload,
} from './transcription-store';

describe('shouldAutoDownload', () => {
  const ok = {
    enabled: true,
    online: true,
    saveData: false,
    ready: false,
    downloading: false,
  };

  it('downloads when enabled, online, not saving data, and not yet cached', () => {
    expect(shouldAutoDownload(ok)).toBe(true);
  });

  it.each([
    ['the user switched it off', { enabled: false }],
    ['the browser is offline', { online: false }],
    ['the connection prefers saving data', { saveData: true }],
    ['the model is already cached', { ready: true }],
    ['a download is already running', { downloading: true }],
  ])('stays quiet when %s', (_label, override) => {
    expect(shouldAutoDownload({ ...ok, ...override })).toBe(false);
  });
});

describe('connectionPrefersSavingData', () => {
  it('reads the Network Information saveData flag when present', () => {
    expect(
      connectionPrefersSavingData({
        connection: { saveData: true },
      } as unknown as Navigator),
    ).toBe(true);
    expect(connectionPrefersSavingData({} as Navigator)).toBe(false);
  });
});

describe('describeTranscriptionError', () => {
  const online = { online: true, modelReady: true };

  it('names an undecodable audio format', () => {
    expect(
      describeTranscriptionError(
        new DOMException('x', 'EncodingError'),
        online,
      ),
    ).toMatch(/audio format/);
  });

  it('points at the download when offline without the model', () => {
    expect(
      describeTranscriptionError(new TypeError('Failed to fetch'), {
        online: false,
        modelReady: false,
      }),
    ).toMatch(/offline/);
  });

  it('blames the network for a fetch failure while online without the model', () => {
    expect(
      describeTranscriptionError(new TypeError('Failed to fetch'), {
        online: true,
        modelReady: false,
      }),
    ).toMatch(/download the transcription model/);
  });

  it('reports storage quota problems', () => {
    expect(
      describeTranscriptionError(
        new Error(
          'Not enough browser storage for offline transcription assets.',
        ),
        online,
      ),
    ).toMatch(/storage/);
  });

  it('falls back to a generic retry line', () => {
    expect(describeTranscriptionError(new Error('boom'), online)).toBe(
      'Transcription failed. Try again.',
    );
  });
});

describe('createDownloadProgressTracker', () => {
  it('sums per-file progress into one percentage', () => {
    const track = createDownloadProgressTracker();
    expect(track({ status: 'initiate', file: 'a' })).toBeNull();
    expect(
      track({ status: 'progress', file: 'a', loaded: 50, total: 100 }),
    ).toBe(50);
    expect(
      track({ status: 'progress', file: 'b', loaded: 0, total: 100 }),
    ).toBe(25);
    expect(track({ status: 'done', file: 'a' })).toBe(50);
    expect(
      track({ status: 'progress', file: 'b', loaded: 100, total: 100 }),
    ).toBe(100);
  });
});

describe('scheduleAutoTranscriptionDownload', () => {
  // The scheduler is module-scoped (runs once per app), so each case gets a
  // fresh module graph with its own idle callback and preference.
  let idle: (() => void) | null;

  beforeEach(() => {
    vi.resetModules();
    idle = null;
    localStorage.clear();
    assets.downloadTranscriptionAssets.mockReset();
    assets.downloadTranscriptionAssets.mockResolvedValue({
      ready: true,
      storedBytes: 100,
      totalBytes: 100,
      storedAssets: 1,
      totalAssets: 1,
    });
    (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback =
      (cb: () => void) => {
        idle = cb;
        return 1;
      };
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: false },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'connection');
  });

  async function runScheduler() {
    const mod = await import('./transcription-store');
    mod.scheduleAutoTranscriptionDownload();
    expect(idle).toBeTypeOf('function');
    idle?.();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    return mod;
  }

  it('starts the download from the idle callback when nothing blocks it', async () => {
    const mod = await runScheduler();
    expect(assets.downloadTranscriptionAssets).toHaveBeenCalledTimes(1);
    expect(get(mod.transcriptionModel).ready).toBe(true);
  });

  it('stays quiet when the user opted out', async () => {
    localStorage.setItem('inbox-rs:offline-transcription', 'false');
    await runScheduler();
    expect(assets.downloadTranscriptionAssets).not.toHaveBeenCalled();
  });

  it('stays quiet on a data-saver connection', async () => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true },
    });
    await runScheduler();
    expect(assets.downloadTranscriptionAssets).not.toHaveBeenCalled();
  });

  it('stays quiet while offline', async () => {
    const stores = await import('./stores');
    stores.browserOnline.set(false);
    await runScheduler();
    expect(assets.downloadTranscriptionAssets).not.toHaveBeenCalled();
  });

  it('reports a failed status check instead of rejecting', async () => {
    assets.getTranscriptionAssetStatus.mockRejectedValueOnce(
      new Error('idb closed'),
    );
    const mod = await import('./transcription-store');
    await expect(
      mod.refreshTranscriptionModelStatus(),
    ).resolves.toBeUndefined();
    const state = get(mod.transcriptionModel);
    expect(state.checked).toBe(true);
    expect(state.error).toMatch(/storage/i);
  });
});

describe('setOfflineTranscriptionEnabled(false)', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    assets.deleteTranscriptionAssets.mockClear();
  });

  it('aborts a running download before deleting, and never reports it done', async () => {
    let seenSignal: AbortSignal | undefined;
    assets.downloadTranscriptionAssets.mockImplementationOnce(
      (_onProgress: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          seenSignal = signal;
          signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const mod = await import('./transcription-store');
    const download = mod.downloadTranscriptionModel();
    expect(get(mod.transcriptionModel).downloading).toBe(true);

    await mod.setOfflineTranscriptionEnabled(false);
    await download;

    expect(seenSignal?.aborted).toBe(true);
    expect(assets.deleteTranscriptionAssets).toHaveBeenCalledTimes(1);
    const state = get(mod.transcriptionModel);
    expect(state).toMatchObject({
      ready: false,
      downloading: false,
      error: '',
    });
    expect(localStorage.getItem('inbox-rs:offline-transcription')).toBe(
      'false',
    );
  });

  it('maps QuotaExceededError to storage guidance', async () => {
    assets.downloadTranscriptionAssets.mockRejectedValueOnce(
      new DOMException('quota', 'QuotaExceededError'),
    );
    const mod = await import('./transcription-store');
    await mod.downloadTranscriptionModel();
    expect(get(mod.transcriptionModel).error).toMatch(/storage/i);
  });
});
