// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeBlockAutoIndent } from '../lib/tiptap-code-indent';

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
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        CodeBlockLowlight.configure({
          lowlight: createLowlight(common),
          enableTabIndentation: true,
          tabSize: 2,
        }),
        Markdown.configure({
          html: false,
          breaks: true,
          tightLists: true,
          transformPastedText: true,
        }),
        CodeBlockAutoIndent,
      ],
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
});
