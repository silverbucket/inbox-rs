// @vitest-environment jsdom
import type { ImageItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    connected: writable(false),
    blobUrls: writable<Record<string, string>>({}),
    loadFileBlobUrl: vi.fn(),
  };
});

vi.mock('../../lib/rs', () => ({
  default: {},
  fetchFileBlobUrl: vi.fn(),
  fetchFileWithAuth: vi.fn(),
}));

import { blobUrls } from '../../lib/stores';
import ImageView from './ImageView.svelte';

describe('ImageView source fallback', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    blobUrls.set({});
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    host.remove();
  });

  it('falls back to the remote source when a local blob cannot render', () => {
    const item: ImageItem = {
      id: 'image-with-fallback',
      type: 'image',
      title: 'Image',
      filePath: 'files/image.jpg',
      mimeType: 'image/jpeg',
      sourceUrl: 'https://example.com/fallback.jpg',
      createdAt: '2026-08-27T10:00:00.000Z',
    };
    blobUrls.set({ [item.filePath]: 'blob:cache/corrupt' });
    component = mount(ImageView, {
      target: host,
      props: { item, titleId: 'title' },
    });
    flushSync();

    host.querySelector('img')?.dispatchEvent(new Event('error'));
    flushSync();

    expect(host.querySelector('img')?.getAttribute('src')).toBe(item.sourceUrl);
    expect(host.textContent).not.toContain('Preview blocked by source');
  });
});
