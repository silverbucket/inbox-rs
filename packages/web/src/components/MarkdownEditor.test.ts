// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createMarkdownEditorExtensions } from '../lib/markdown-editor';
import { items } from '../lib/stores';

type MarkdownStorage = {
  markdown: { getMarkdown(): string };
};

describe('MarkdownEditor markdown compatibility', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  function roundTrip(markdown: string): string {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createMarkdownEditorExtensions(),
      content: markdown,
    });

    return (
      editor.storage as unknown as MarkdownStorage
    ).markdown.getMarkdown();
  }

  it.each([
    {
      name: 'headings and inline formatting',
      markdown: '# Heading\n\nA **bold**, *italic*, and ~~deleted~~ line.',
    },
    {
      name: 'nested ordered and unordered lists',
      markdown: '- parent\n  - child\n    1. numbered child',
    },
    {
      name: 'fenced code with a language label',
      markdown: '```typescript\nconst answer: number = 42;\n```',
    },
    {
      name: 'blockquote, rule, and link',
      markdown: '> quoted [link](https://example.com)\n\n---',
    },
  ])('preserves $name through the visual editor', ({ markdown }) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  /** Paste plain text the way a browser does (Ctrl/Cmd+V). */
  function paste(text: string) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string) => (type === 'text/plain' ? text : ''),
      },
    });
    editor?.view.dom.dispatchEvent(event);
  }

  function markdown(): string {
    return (
      editor?.storage as unknown as MarkdownStorage
    ).markdown.getMarkdown();
  }

  it('turns a pasted web address into a link', () => {
    roundTrip('');
    paste('https://example.com/a?b=1');

    const link = editor?.view.dom.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/a?b=1');
    expect(link?.textContent).toBe('https://example.com/a?b=1');
    // Stored as the address itself, exactly as it was pasted.
    expect(markdown()).toBe('https://example.com/a?b=1');
  });

  it('keeps words typed after a pasted address out of the link', () => {
    roundTrip('');
    paste('https://example.com/docs');
    editor?.commands.insertContent(' is worth reading');

    expect(editor?.view.dom.querySelector('a')?.textContent).toBe(
      'https://example.com/docs',
    );
    expect(markdown()).toBe('https://example.com/docs is worth reading');
  });

  it('links a web address pasted inside a sentence', () => {
    roundTrip('');
    paste('see https://example.com/docs for more');

    expect(editor?.view.dom.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/docs',
    );
    expect(markdown()).toBe('see https://example.com/docs for more');
  });

  it.each([
    { name: 'a bare address', markdown: 'https://example.com/page' },
    {
      name: 'an address in a sentence',
      markdown: 'Read https://example.com now',
    },
    {
      name: 'a link whose text is its address',
      markdown: '[https://example.com/a(b)](https://example.com/a\\(b\\))',
    },
    {
      name: 'a file name that looks like a domain',
      markdown: 'Edit readme.md',
    },
    { name: 'an email address', markdown: 'Ask sam@example.com' },
  ])('keeps $name as written', ({ markdown: source }) => {
    expect(roundTrip(source)).toBe(source);
  });

  it('shows a web address already in the text as a link', () => {
    roundTrip('Read https://example.com now');

    expect(editor?.view.dom.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com',
    );
  });

  it('does not link a file name or an email address', () => {
    roundTrip('Edit readme.md and ask sam@example.com');

    expect(editor?.view.dom.querySelector('a')).toBeNull();
  });

  it('documents that GFM tables are currently lossy in visual mode', () => {
    const markdown = '| Name | Value |\n| --- | ---: |\n| One | 1 |';

    expect(roundTrip(markdown)).toBe('NameValueOne1');
  });

  it('documents that GFM task lists are currently lossy in visual mode', () => {
    const markdown = '- [x] done\n- [ ] pending';

    expect(roundTrip(markdown)).toBe('- \\[x\\] done\n- \\[ \\] pending');
  });

  it('keeps a link to another item as a plain markdown link', () => {
    const markdown =
      'See [Trip plan](#/item/abc-1) and [web](https://example.com)';

    expect(roundTrip(markdown)).toBe(markdown);
    // It is its own node (a chip), not an ordinary link mark.
    expect(editor?.getJSON().content?.[0].content?.[1]).toEqual({
      type: 'itemLink',
      attrs: { id: 'abc-1', title: 'Trip plan' },
    });
  });

  it("saves an item link with the target's current title", () => {
    items.set({
      'abc-1': {
        id: 'abc-1',
        type: 'note',
        title: 'Trip plan (final)',
        body: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    try {
      expect(roundTrip('[Trip plan](#/item/abc-1)')).toBe(
        '[Trip plan (final)](#/item/abc-1)',
      );
    } finally {
      items.set({});
    }
  });
});
