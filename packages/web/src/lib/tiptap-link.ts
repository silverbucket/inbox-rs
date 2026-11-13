import Link from '@tiptap/extension-link';
import type { Mark, Node } from '@tiptap/pm/model';

/** The part of the markdown serializer state this file uses. */
interface SerializerState {
  esc(text: string): string;
  /** Set between a link's open and close when it is written bare. */
  bareLink?: boolean;
}

// Characters a web address can be written with, unwrapped, and still be
// read back whole: no brackets, quotes or `*`, and no closing punctuation
// that a reader would take as the end of the sentence.
const BARE_URL = /^https?:\/\/[\w\-.~:/?#@!$&+,;=%]*[\w\-/~#=&%+@$]$/i;

function textOf(node: Node | null): string | null {
  return node?.isText ? (node.text ?? '') : null;
}

/**
 * True when a link can be saved as its bare address (`https://…`) and come
 * back as the same link: its text is the address, nothing else styles it,
 * and the text on either side cannot be mistaken for part of it.
 */
function isBareUrl(
  state: SerializerState,
  mark: Mark,
  parent: Node,
  index: number,
): boolean {
  const content = parent.child(index);
  const href: string = mark.attrs.href ?? '';
  if (mark.attrs.title || content.text !== href || content.marks.length !== 1) {
    return false;
  }
  if (!BARE_URL.test(href) || state.esc(href) !== href) return false;
  const before = textOf(index > 0 ? parent.child(index - 1) : null);
  const after = textOf(
    index + 1 < parent.childCount ? parent.child(index + 1) : null,
  );
  return (
    (before === null || /(?:^|[\s(])$/.test(before)) &&
    (after === null || /^(?:$|[\s.,;:!?)])/.test(after))
  );
}

/**
 * The editor's link, saved to markdown so that a pasted or typed web
 * address stays exactly as written (`https://example.com`) instead of
 * gaining angle brackets, and every other link is `[text](address)`.
 */
export const MarkdownLink = Link.extend({
  // Text typed right after a link is not part of it. (The stock link grows
  // with whatever follows it, so words written after a pasted address
  // would all become the link.)
  inclusive() {
    return false;
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open(
            state: SerializerState,
            mark: Mark,
            parent: Node,
            index: number,
          ) {
            state.bareLink = isBareUrl(state, mark, parent, index);
            return state.bareLink ? '' : '[';
          },
          close(state: SerializerState, mark: Mark) {
            const bare = state.bareLink;
            state.bareLink = undefined;
            if (bare) return '';
            const href = String(mark.attrs.href ?? '').replace(
              /[()"]/g,
              '\\$&',
            );
            const title = mark.attrs.title
              ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"`
              : '';
            return `](${href}${title})`;
          },
          mixable: true,
        },
        parse: {
          // Web addresses in the text become links (see markdown-editor.ts),
          // but only ones written with http(s)://, as when rendering. A file
          // name like readme.md or an email address stays plain text.
          setup(md: {
            linkify: { set(options: Record<string, boolean>): void };
          }) {
            md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });
          },
        },
      },
    };
  },
});
