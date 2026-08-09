import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import { CodeBlockAutoIndent } from './tiptap-code-indent';

export function createMarkdownEditorExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
    }),
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
  ];
}
