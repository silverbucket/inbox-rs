import Paragraph from '@tiptap/extension-paragraph';
import type { Node } from '@tiptap/pm/model';

/** The part of the markdown serializer state this file uses. */
interface SerializerState {
  write(text?: string): void;
  renderInline(node: Node): void;
  closeBlock(node: Node): void;
}

/**
 * What an empty line is saved as. Markdown reads any run of blank lines as
 * one paragraph break, so an empty paragraph needs something on its line to
 * survive; this is the one thing every markdown renderer shows as nothing.
 */
const BLANK_LINE = '&nbsp;';
const NBSP = ' ';

function isBlank(node: Node): boolean {
  return node.type.name === 'paragraph' && node.childCount === 0;
}

/**
 * True for an empty top-level paragraph with text somewhere above and below
 * it. Empty lines at the very start or end are not content and are dropped.
 */
function isBlankLineBetweenContent(parent: Node, index: number): boolean {
  if (parent.type.name !== 'doc' || !isBlank(parent.child(index))) return false;
  let before = false;
  let after = false;
  parent.forEach((sibling, _offset, i) => {
    if (isBlank(sibling)) return;
    if (i < index) before = true;
    if (i > index) after = true;
  });
  return before && after;
}

/**
 * The editor's paragraph, saved to markdown so that the empty lines a
 * writer leaves between paragraphs are still there when the text is opened
 * again.
 */
export const BlankLineParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: SerializerState,
          node: Node,
          parent: Node,
          index: number,
        ) {
          if (isBlankLineBetweenContent(parent, index)) {
            state.write(BLANK_LINE);
          } else {
            state.renderInline(node);
          }
          state.closeBlock(node);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            for (const p of element.querySelectorAll(':scope > p')) {
              if (p.childElementCount === 0 && p.textContent === NBSP) {
                p.textContent = '';
              }
            }
          },
        },
      },
    };
  },
});
