// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The player's blob URL is built from the raw bytes; the remoteStorage
// cache (`rs.inbox.getFile`) may hold a copy the sync layer corrupted via a
// lossy UTF-8 decode. Transcription must read the faithful copy.
const {
  RAW_BYTES,
  CORRUPTED_BYTES,
  PLAYER_URL,
  transcribeAudio,
  getFile,
  storeItem,
  updateItem,
  liveItems,
} = vi.hoisted(() => {
  const CORRUPTED_BYTES = new Uint8Array([0x1a, 0x45, 0xfd, 0xfd, 0xfd, 0x00]);
  return {
    RAW_BYTES: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x89, 0x00, 0xff]),
    CORRUPTED_BYTES,
    PLAYER_URL: 'blob:http://localhost/player-audio',
    transcribeAudio: vi.fn(
      async (
        _blob: Blob,
        _opts?: {
          onProgress?: (
            p: import('../../lib/transcribe').TranscriptionProgress,
          ) => void;
        },
      ) => 'hello world',
    ),
    getFile: vi.fn(async () => ({
      data: CORRUPTED_BYTES.buffer,
      mimeType: 'audio/webm',
    })),
    storeItem: vi.fn(async () => {}),
    // Mirrors stores.updateItem: hand the live item to the callback, write
    // what it returns, skip when it returns null.
    updateItem: vi.fn(
      async (id: string, update: (current: unknown) => unknown) => {
        const next = update(liveItems.get(id));
        if (next) storeItem(next);
        return next;
      },
    ),
    liveItems: new Map<string, unknown>(),
  };
});

vi.mock('../../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    blobUrls: writable<Record<string, string>>({}),
    browserOnline: writable(true),
    connected: writable(true),
    loadFileBlobUrl: vi.fn(),
    storeItem,
    updateItem,
  };
});
vi.mock('../../lib/rs', () => ({
  default: { inbox: { getFile } },
}));
vi.mock('../../lib/transcribe', async () => {
  const actual = await vi.importActual<typeof import('../../lib/transcribe')>(
    '../../lib/transcribe',
  );
  return { ...actual, transcribeAudio };
});
vi.mock('../../lib/transcription-store', async () => {
  const { writable } = await import('svelte/store');
  return {
    TRANSCRIPTION_MODEL_SIZE_LABEL: '72 MB',
    refreshTranscriptionModelStatus: vi.fn(async () => {}),
    transcriptionModel: writable({
      ready: false,
      downloading: false,
      percent: 0,
      error: '',
      checked: true,
    }),
  };
});
vi.mock('../../lib/markdown', () => ({
  renderMarkdown: async (s: string) => s,
}));

import type { AudioItem } from '@inbox-rs/rs-module';
import { blobUrls, browserOnline } from '../../lib/stores';
import { transcriptionModel } from '../../lib/transcription-store';
import AudioView from './AudioView.svelte';

function audio(): AudioItem {
  return {
    id: 'a1',
    type: 'audio',
    title: 'Audio',
    filePath: 'files/a1.webm',
    mimeType: 'audio/webm',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('AudioView transcribe', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    blobUrls.set({ 'files/a1.webm': PLAYER_URL });
    liveItems.clear();
    liveItems.set('a1', audio());
    browserOnline.set(true);
    transcriptionModel.set({
      ready: false,
      downloading: false,
      percent: 0,
      error: '',
      checked: true,
    });
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        if (String(input) !== PLAYER_URL)
          throw new TypeError('unexpected fetch');
        return new Response(RAW_BYTES, { status: 200 });
      });
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
    fetchSpy.mockRestore();
    vi.clearAllMocks();
  });

  async function settle() {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    flushSync();
  }

  it("sends the player's faithful bytes to the transcriber, not the RS cache copy", async () => {
    component = mount(AudioView, {
      target: host,
      props: { item: audio(), titleId: 't' },
    });
    flushSync();

    const button = host.querySelector('button.btn-action') as HTMLButtonElement;
    expect(button?.textContent).toContain('Transcribe');
    button.click();
    await settle();

    expect(getFile).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(PLAYER_URL);
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    const blob = transcribeAudio.mock.calls[0][0];
    expect(blob.type).toBe('audio/webm');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(RAW_BYTES);
    expect(storeItem).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'hello world', transcribed: true }),
    );
    expect(host.textContent).not.toContain('failed');
  });

  it('does not write a transcript for a card deleted while inference ran', async () => {
    let finish: (text: string) => void = () => {};
    transcribeAudio.mockImplementationOnce(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    component = mount(AudioView, {
      target: host,
      props: { item: audio(), titleId: 't' },
    });
    flushSync();
    (host.querySelector('button.btn-action') as HTMLButtonElement).click();
    await settle();

    liveItems.delete('a1'); // deletion landed in the write queue first
    finish('late words');
    await settle();

    expect(updateItem).toHaveBeenCalledWith('a1', expect.any(Function));
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('leaves an existing note alone when transcription returns nothing', async () => {
    transcribeAudio.mockResolvedValueOnce('');
    const existing = { ...audio(), body: 'my typed notes', transcribed: true };
    liveItems.set('a1', existing);
    component = mount(AudioView, {
      target: host,
      props: { item: existing, titleId: 't' },
    });
    flushSync();
    (host.querySelector('button.btn-link') as HTMLButtonElement).click();
    await settle();

    expect(updateItem).not.toHaveBeenCalled();
    expect(storeItem).not.toHaveBeenCalled();
    expect(host.textContent).toContain('No speech detected');
  });

  it('does not overwrite a note edited and saved while transcribing', async () => {
    let finish: (text: string) => void = () => {};
    transcribeAudio.mockImplementationOnce(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    component = mount(AudioView, {
      target: host,
      props: { item: audio(), titleId: 't' },
    });
    flushSync();
    (host.querySelector('button.btn-action') as HTMLButtonElement).click();
    await settle();

    liveItems.set('a1', { ...audio(), body: 'typed meanwhile' });
    finish('model words');
    await settle();

    expect(storeItem).not.toHaveBeenCalled();
    expect(host.textContent).toContain('edited while transcribing');
  });

  it('appends a new transcript below a note the user typed instead of replacing it', async () => {
    transcribeAudio.mockResolvedValueOnce('model words');
    const existing = {
      ...audio(),
      body: 'call Sam re: invoice',
      transcribed: true,
    };
    liveItems.set('a1', existing);
    component = mount(AudioView, {
      target: host,
      props: { item: existing, titleId: 't' },
    });
    flushSync();
    (host.querySelector('button.btn-link') as HTMLButtonElement).click();
    await settle();

    expect(storeItem).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'call Sam re: invoice\n\nmodel words',
        transcribed: true,
      }),
    );
  });

  it('does not stack another copy when the transcript is already in the body', async () => {
    transcribeAudio.mockResolvedValueOnce('model words');
    const existing = {
      ...audio(),
      body: 'my note\n\nmodel words',
      transcribed: true,
    };
    liveItems.set('a1', existing);
    component = mount(AudioView, {
      target: host,
      props: { item: existing, titleId: 't' },
    });
    flushSync();
    (host.querySelector('button.btn-link') as HTMLButtonElement).click();
    await settle();

    expect(storeItem).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Transcript unchanged');
  });

  it('shows nothing offline for an item that already has a transcript', () => {
    browserOnline.set(false);
    component = mount(AudioView, {
      target: host,
      props: {
        item: { ...audio(), body: 'old text', transcribed: true },
        titleId: 't',
      },
    });
    flushSync();
    expect(host.textContent).not.toContain('one-time');
    expect(host.querySelector('button.btn-link')?.textContent).toContain(
      'Transcribe again',
    );
  });

  it('shows download progress, then transcribing, with a Cancel button', async () => {
    let resolveRun: (text: string) => void = () => {};
    transcribeAudio.mockImplementationOnce(
      (_blob, opts) =>
        new Promise<string>((resolve) => {
          opts?.onProgress?.({ phase: 'downloading', percent: 43 });
          resolveRun = resolve;
        }),
    );
    component = mount(AudioView, {
      target: host,
      props: { item: audio(), titleId: 't' },
    });
    flushSync();
    (host.querySelector('button.btn-action') as HTMLButtonElement).click();
    await settle();

    expect(host.textContent).toContain('Downloading transcription model 43%');
    const cancel = host.querySelector('button.btn-action') as HTMLButtonElement;
    expect(cancel.textContent).toContain('Cancel');
    cancel.click();
    flushSync();
    expect(host.textContent).not.toContain('Downloading');
    expect(host.querySelector('button.btn-action')?.textContent).toContain(
      'Transcribe',
    );

    // A late result from the cancelled run must not be saved.
    resolveRun('late');
    await settle();
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('explains the one-time download instead of offering Transcribe when offline without the model', () => {
    browserOnline.set(false);
    component = mount(AudioView, {
      target: host,
      props: { item: audio(), titleId: 't' },
    });
    flushSync();
    expect(host.querySelector('button.btn-action')).toBeNull();
    expect(host.textContent).toContain('one-time 72 MB download');
  });

  it('offers "Transcribe again" once the item already has a transcript', () => {
    component = mount(AudioView, {
      target: host,
      props: {
        item: { ...audio(), body: 'old text', transcribed: true },
        titleId: 't',
      },
    });
    flushSync();
    expect(host.querySelector('button.btn-action')).toBeNull();
    expect(host.querySelector('button.btn-link')?.textContent).toContain(
      'Transcribe again',
    );
  });

  it('shows the failure state with a retry when the decoder rejects', async () => {
    transcribeAudio.mockRejectedValueOnce(
      new DOMException('Unable to decode audio data', 'EncodingError'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    component = mount(AudioView, {
      target: host,
      props: { item: audio(), titleId: 't' },
    });
    flushSync();
    (host.querySelector('button.btn-action') as HTMLButtonElement).click();
    await settle();

    expect(host.textContent).toContain(
      "This audio format can't be decoded in your browser.",
    );
    expect(host.querySelector('button.btn-action')?.textContent).toContain(
      'Retry',
    );
    expect(storeItem).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
