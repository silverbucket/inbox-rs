import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  buildLinkPreviewCard,
  cachedLinkPreview,
  loadLinkPreview,
  MAX_LINK_PREVIEWS,
  standaloneUrl,
} from './link-preview';

// How long an address must stay unchanged before its preview is fetched,
// so typing one out does not ask the service about every keystroke.
const SETTLE_MS = 700;

/** The web addresses that stand alone on a line of a top-level paragraph. */
function standaloneUrls(paragraph: Node): string[] {
  const urls: string[] = [];
  // One entry per line; null once a line holds more than a single text.
  let line: string | null = '';
  const endLine = () => {
    const url = standaloneUrl(line);
    if (url) urls.push(url);
    line = '';
  };
  paragraph.forEach((child) => {
    if (child.type.name === 'hardBreak') endLine();
    else if (child.isText && line !== null) line += child.text ?? '';
    else line = null;
  });
  endLine();
  return urls;
}

/** The slot a preview card appears in, under the paragraph with the link. */
function previewSlot(url: string, timers: WeakMap<HTMLElement, number>) {
  const slot = document.createElement('div');
  slot.className = 'link-preview-slot';
  slot.contentEditable = 'false';
  slot.hidden = true;
  const show = (preview: Awaited<ReturnType<typeof loadLinkPreview>>) => {
    if (!preview) return;
    slot.replaceChildren(buildLinkPreviewCard(url, preview));
    slot.hidden = false;
  };
  const known = cachedLinkPreview(url);
  if (known !== undefined) {
    show(known);
  } else {
    timers.set(
      slot,
      window.setTimeout(() => void loadLinkPreview(url).then(show), SETTLE_MS),
    );
  }
  return slot;
}

/**
 * Shows a preview card under each web address that stands alone on its
 * line, in the visual editor. The card is display only: it is not part of
 * the text and nothing about it is saved.
 */
export const LinkPreview = Extension.create({
  name: 'linkPreview',

  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>('linkPreview');
    const timers = new WeakMap<HTMLElement, number>();

    const build = (doc: Node) => {
      const decorations: Decoration[] = [];
      doc.forEach((node, offset) => {
        if (node.type.name !== 'paragraph') return;
        for (const url of standaloneUrls(node)) {
          if (decorations.length >= MAX_LINK_PREVIEWS) return;
          decorations.push(
            Decoration.widget(
              offset + node.nodeSize,
              () => previewSlot(url, timers),
              {
                // Same address, same card: it is kept while the rest of
                // the text is edited, and rebuilt when the address changes.
                key: `link-preview:${decorations.length}:${url}`,
                side: -1,
                ignoreSelection: true,
                // A click follows the card's own link; the editor must not
                // also open the address or move the cursor.
                stopEvent: () => true,
                destroy: (dom) => {
                  window.clearTimeout(timers.get(dom as HTMLElement));
                },
              },
            ),
          );
        }
      });
      return DecorationSet.create(doc, decorations);
    };

    return [
      new Plugin({
        key,
        state: {
          init: (_, { doc }) => build(doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});
