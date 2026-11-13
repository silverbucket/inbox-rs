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
