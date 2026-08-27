// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable stores + a spy for the loader the component is meant to call.
// Both the component and this test import from '../lib/stores', so they share
// these instances.
vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    connected: writable(false),
    blobUrls: writable<Record<string, string>>({}),
    loadFileBlobUrl: vi.fn(),
  };
});

// Lightbox (imported by ImageCard) pulls in ../lib/rs, which constructs a
// RemoteStorage at import time. Neutralise it.
vi.mock('../lib/rs', () => ({
  default: {},
  fetchFileBlobUrl: vi.fn(),
  fetchFileWithAuth: vi.fn(),
}));

import type { ImageItem } from '@inbox-rs/rs-module';
import { blobUrls, connected, loadFileBlobUrl } from '../lib/stores';
import ImageCard from './ImageCard.svelte';
import ImageCardTestHarness from './ImageCardTestHarness.svelte';

const item: ImageItem = {
  id: 'img1',
  type: 'image',
  title: 'Holiday',
  filePath: 'files/img1.png',
  mimeType: 'image/png',
  createdAt: 0,
};

describe('ImageCard offline display', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    connected.set(false);
    blobUrls.set({});
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    host.remove();
  });

  it('requests the file even when not connected, so cached images render offline', () => {
    // Regression: file-display cards used to gate loading on `$connected`, so a
    // file captured while disconnected never loaded from the local cache and
    // showed a "Not connected" placeholder after reload.
    component = mount(ImageCard, { target: host, props: { item } });
    flushSync();

    expect(loadFileBlobUrl).toHaveBeenCalledWith('files/img1.png', 'image/png');
  });

  it('renders the image (not the placeholder) once a blob URL is present', () => {
    blobUrls.set({ 'files/img1.png': 'blob:cache/img1' });

    component = mount(ImageCard, { target: host, props: { item } });
    flushSync();

    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      'blob:cache/img1',
    );
    expect(host.textContent).not.toContain('Not connected');
  });

  it('falls back to the remote source when a local blob cannot render', () => {
    const itemWithFallback: ImageItem = {
      ...item,
      sourceUrl: 'https://example.com/fallback.png',
    };
    blobUrls.set({ 'files/img1.png': 'blob:cache/corrupt' });

    component = mount(ImageCard, {
      target: host,
      props: { item: itemWithFallback },
    });
    flushSync();
    host.querySelector('img')?.dispatchEvent(new Event('error'));
    flushSync();

    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      itemWithFallback.sourceUrl,
    );
  });

  it('uses the source URL when an image has no locally captured file', () => {
    const remoteItem: ImageItem = {
      id: 'remote-image',
      type: 'image',
      title: 'Remote image',
      sourceUrl: 'https://example.com/remote.jpg',
      createdAt: '2026-08-26T10:00:00.000Z',
    };

    component = mount(ImageCard, {
      target: host,
      props: { item: remoteItem },
    });
    flushSync();

    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      remoteItem.sourceUrl,
    );
    expect(loadFileBlobUrl).not.toHaveBeenCalled();
  });

  it('retries a remote image after its source URL is corrected', () => {
    const remoteItem: ImageItem = {
      id: 'remote-image',
      type: 'image',
      title: 'Remote image',
      sourceUrl: 'https://example.com/broken.jpg',
      createdAt: '2026-08-26T10:00:00.000Z',
    };

    component = mount(ImageCardTestHarness, {
      target: host,
      props: { initialItem: remoteItem },
    });
    flushSync();

    host.querySelector('img')?.dispatchEvent(new Event('error'));
    flushSync();
    expect(host.querySelector('img')).toBeNull();

    const correctedUrl = 'https://example.com/corrected.jpg';
    (
      component as ReturnType<typeof mount> & {
        updateSourceUrl: (sourceUrl: string) => void;
      }
    ).updateSourceUrl(correctedUrl);
    flushSync();

    expect(host.querySelector('img')?.getAttribute('src')).toBe(correctedUrl);
  });
});
