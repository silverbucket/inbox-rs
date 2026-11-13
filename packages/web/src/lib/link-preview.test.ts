// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cachedLinkPreview,
  LINK_PREVIEW_CACHE_KEY,
  linkPreviews,
  loadLinkPreview,
  MAX_LINK_PREVIEWS,
  standaloneUrl,
} from './link-preview';
import { createMarkdownEditorExtensions } from './markdown-editor';

const fetchLinkMetadata = vi.hoisted(() => vi.fn());
vi.mock('./link-metadata', async (original) => ({
  ...(await original<typeof import('./link-metadata')>()),
  fetchLinkMetadata,
}));

const PAGE = {
  title: 'Example Domain',
  description: 'A page used in examples.',
  siteName: 'Example',
  image: 'https://example.com/card.png',
  favicon: 'https://example.com/icon.png',
};

/** Let the fetch promise and the DOM observer both run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A fresh address per test, so one test's fetch never answers another's. */
let serial = 0;
const freshUrl = () => `https://example.com/page-${++serial}`;

beforeEach(() => {
  localStorage.clear();
  fetchLinkMetadata.mockReset();
  fetchLinkMetadata.mockResolvedValue(PAGE);
});

describe('standaloneUrl', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['  http://example.com  ', 'http://example.com'],
    ['<https://example.com/a>', 'https://example.com/a'],
  ])('reads %j as a link', (text, url) => {
    expect(standaloneUrl(text)).toBe(url);
  });

  it.each([
    'see https://example.com',
    'https://example.com and more',
    'example.com',
    'ftp://example.com',
    'mailto:sam@example.com',
    'https://sam:secret@example.com/',
    '',
  ])('does not read %j as a link', (text) => {
    expect(standaloneUrl(text)).toBeNull();
  });
});

describe('loadLinkPreview', () => {
  it('asks the service once and remembers the answer in this browser', async () => {
    const url = freshUrl();
    const first = await loadLinkPreview(`${url}#section`);
    expect(first).toMatchObject({ title: 'Example Domain' });
    // The fragment stays in the browser.
    expect(fetchLinkMetadata).toHaveBeenCalledWith(url, expect.any(String));

    await loadLinkPreview(`${url}#section`);
    expect(fetchLinkMetadata).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(LINK_PREVIEW_CACHE_KEY)).toContain(url);
  });

  it('gives no preview when the page has no title', async () => {
    fetchLinkMetadata.mockResolvedValue({ siteName: 'Example' });
    expect(await loadLinkPreview(freshUrl())).toBeNull();
  });

  it('gives no preview, and does not fail, when the service is down', async () => {
    fetchLinkMetadata.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await loadLinkPreview(freshUrl())).toBeNull();
  });

  it('does not contact the service when link previews are turned off', async () => {
    localStorage.setItem('inbox-rs:link-previews', 'false');
    expect(await loadLinkPreview(freshUrl())).toBeNull();
    expect(fetchLinkMetadata).not.toHaveBeenCalled();
  });

  it('shows no preview fetched earlier once link previews are turned off', async () => {
    const url = freshUrl();
    expect(await loadLinkPreview(url)).not.toBeNull();

    localStorage.setItem('inbox-rs:link-previews', 'false');
    expect(await loadLinkPreview(url)).toBeNull();
    expect(cachedLinkPreview(url)).toBeNull();
  });
});

describe('linkPreviews (rendered text)', () => {
  let root: HTMLElement;
  let action: { destroy?(): void };

  function render(html: string) {
    root = document.createElement('div');
    root.innerHTML = html;
    document.body.append(root);
    action = linkPreviews(root);
  }

  afterEach(() => {
    action.destroy?.();
    root.remove();
  });

  it('replaces a link alone on its line with its preview card', async () => {
    const url = freshUrl();
    render(`<p>Intro</p><p><a href="${url}">${url}</a></p>`);
    await settle();

    const card = root.querySelector<HTMLAnchorElement>('a.link-preview');
    expect(card?.href).toBe(url);
    expect(card?.target).toBe('_blank');
    expect(card?.querySelector('.link-preview-title')?.textContent).toBe(
      'Example Domain',
    );
    expect(card?.querySelector('.link-preview-host')?.textContent).toBe(
      'Example',
    );
    expect(
      root
        .querySelector(`a[href="${url}"]:not(.link-preview)`)
        ?.getAttribute('data-link-preview'),
    ).toBe('shown');
  });

  it('previews each link that has a line to itself', async () => {
    const a = freshUrl();
    const b = freshUrl();
    render(`<p><a href="${a}">${a}</a><br><a href="${b}">${b}</a></p>`);
    await settle();

    expect(root.querySelectorAll('a.link-preview')).toHaveLength(2);
  });

  it('leaves links inside a sentence, a list or with their own text alone', async () => {
    const url = freshUrl();
    render(
      `<p>See <a href="${url}">${url}</a> for more</p>` +
        `<ul><li><p><a href="${url}">${url}</a></p></li></ul>` +
        `<p><a href="${url}">The docs</a></p>`,
    );
    await settle();

    expect(root.querySelector('a.link-preview')).toBeNull();
    expect(fetchLinkMetadata).not.toHaveBeenCalled();
  });

  it('keeps the plain link when there is no preview to show', async () => {
    fetchLinkMetadata.mockResolvedValue(null);
    const url = freshUrl();
    render(`<p><a href="${url}">${url}</a></p>`);
    await settle();

    expect(root.querySelector('a.link-preview')).toBeNull();
    expect(root.querySelector('a')?.dataset.linkPreview).toBe('none');
  });

  it('previews text rendered after it was mounted', async () => {
    render('');
    const url = freshUrl();
    root.innerHTML = `<p><a href="${url}">${url}</a></p>`;
    await settle();
    await settle();

    expect(root.querySelector('a.link-preview')).not.toBeNull();
  });

  it(`previews at most ${MAX_LINK_PREVIEWS} links`, async () => {
    const paragraphs = Array.from({ length: MAX_LINK_PREVIEWS + 3 }, () => {
      const url = freshUrl();
      return `<p><a href="${url}">${url}</a></p>`;
    });
    render(paragraphs.join(''));
    await settle();

    expect(fetchLinkMetadata).toHaveBeenCalledTimes(MAX_LINK_PREVIEWS);
  });

  it('does nothing when switched off for this text', async () => {
    const url = freshUrl();
    root = document.createElement('div');
    root.innerHTML = `<p><a href="${url}">${url}</a></p>`;
    document.body.append(root);
    action = linkPreviews(root, false);
    await settle();

    expect(fetchLinkMetadata).not.toHaveBeenCalled();
  });
});

describe('link previews in the visual editor', () => {
  let editor: Editor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    vi.useRealTimers();
  });

  function open(content: string, options?: { linkPreviews?: boolean }) {
    const element = document.createElement('div');
    document.body.append(element);
    editor = new Editor({
      element,
      extensions: createMarkdownEditorExtensions(options),
      content,
    });
    return editor;
  }

  const markdown = () =>
    (
      editor?.storage as unknown as { markdown: { getMarkdown(): string } }
    ).markdown.getMarkdown();

  it('shows a card under a link alone on its line, without changing the text', async () => {
    const url = freshUrl();
    const e = open(`Reading list\n\n${url}`);
    expect(e.view.dom.querySelector('a.link-preview')).toBeNull();

    await vi.advanceTimersByTimeAsync(800);

    const card = e.view.dom.querySelector<HTMLAnchorElement>(
      '.link-preview-slot a.link-preview',
    );
    expect(card?.href).toBe(url);
    expect(card?.textContent).toContain('Example Domain');
    expect(markdown()).toBe(`Reading list\n\n${url}`);
  });

  it('waits for the address to settle before asking about it', async () => {
    const url = freshUrl();
    const e = open(url);
    await vi.advanceTimersByTimeAsync(300);
    // Still typing: the address grows before the wait is over.
    e.commands.insertContentAt(e.state.doc.content.size - 1, '/more');
    await vi.advanceTimersByTimeAsync(800);

    expect(fetchLinkMetadata).toHaveBeenCalledTimes(1);
    expect(fetchLinkMetadata).toHaveBeenCalledWith(
      `${url}/more`,
      expect.any(String),
    );
  });

  it('shows no card for a link inside a sentence', async () => {
    open(`See ${freshUrl()} for more`);
    await vi.advanceTimersByTimeAsync(800);

    expect(fetchLinkMetadata).not.toHaveBeenCalled();
  });

  it('never looks up links when previews are off for this editor (emails)', async () => {
    open(freshUrl(), { linkPreviews: false });
    await vi.advanceTimersByTimeAsync(800);

    expect(fetchLinkMetadata).not.toHaveBeenCalled();
  });
});
