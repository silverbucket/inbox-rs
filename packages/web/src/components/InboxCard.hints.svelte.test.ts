// @vitest-environment jsdom
import type { Collection, NoteItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    connected: writable(false),
    blobUrls: writable<Record<string, string>>({}),
    loadFileBlobUrl: vi.fn(),
    draggingItemId: writable<string | null>(null),
    setItemPinned: vi.fn(),
  };
});
vi.mock('../lib/rs', () => ({
  default: {},
  fetchFileBlobUrl: vi.fn(),
  fetchFileWithAuth: vi.fn(),
}));

import InboxCard from './InboxCard.svelte';

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);

const card: NoteItem = {
  id: 'n1',
  type: 'note',
  title: 'Politics this week',
  body: 'Some notes',
  createdAt: yesterday.toISOString(),
};

const politics = {
  id: 'pol',
  name: 'Politics',
  color: '#15803d',
  itemIds: [],
} as unknown as Collection;

describe('InboxCard hints', () => {
  let host: HTMLElement | undefined;
  let component: ReturnType<typeof mount> | undefined;

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host?.remove();
  });

  function render(props: Record<string, unknown>) {
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(InboxCard, {
      target: host,
      props: { item: card, onselect: vi.fn(), ...props },
    });
    flushSync();
    return host;
  }

  it('dates the card relatively and drops the repeated type tag', () => {
    const el = render({});
    expect(el.querySelector('.card-kind .date')?.textContent).toBe('yesterday');
    expect(el.querySelector('.type-tag')).toBeNull();
    expect(el.querySelector('.kind-label')?.textContent).toBe('Note');
  });

  it('shows the warning line and files from the suggestion without opening the card', () => {
    const onselect = vi.fn();
    const onfile = vi.fn();
    const el = render({
      onselect,
      onfile,
      hints: {
        flag: 'Same as “Other” — archive one?',
        suggest: politics,
        duplicate: true,
      },
    });
    expect(el.querySelector('.hint-flag')?.textContent).toContain('Same as');
    expect(el.querySelector('article')?.classList.contains('duplicate')).toBe(
      true,
    );
    const button = el.querySelector<HTMLButtonElement>('.hint-file');
    expect(button?.textContent?.trim()).toBe('File to Politics?');
    button?.click();
    expect(onfile).toHaveBeenCalledWith(politics);
    expect(onselect).not.toHaveBeenCalled();
  });

  it('shows no hints outside the Inbox', () => {
    const el = render({});
    expect(el.querySelector('.hint-flag')).toBeNull();
    expect(el.querySelector('.hint-file')).toBeNull();
  });
});
