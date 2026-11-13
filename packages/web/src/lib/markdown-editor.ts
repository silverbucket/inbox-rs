import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import { CodeBlockAutoIndent } from './tiptap-code-indent';
import { ItemLink } from './tiptap-item-link';
import { MarkdownLink } from './tiptap-link';
import { LinkPreview } from './tiptap-link-preview';

export function createMarkdownEditorExtensions({
  linkPreviews = true,
}: {
  /** Show a preview card under a web address alone on its line. */
  linkPreviews?: boolean;
} = {}) {
  return [
    StarterKit.configure({
      codeBlock: false,
      // Replaced by MarkdownLink below.
      link: false,
    }),
    MarkdownLink,
    CodeBlockLowlight.configure({
      lowlight: createLowlight(common),
      enableTabIndentation: true,
      tabSize: 2,
    }),
    Markdown.configure({
      html: false,
      // A web address in pasted or loaded text is a link, not plain text.
      linkify: true,
      breaks: true,
      tightLists: true,
      transformPastedText: true,
    }),
    CodeBlockAutoIndent,
    ItemLink,
    ...(linkPreviews ? [LinkPreview] : []),
  ];
}
