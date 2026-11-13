import { Node } from '@tiptap/core';
import { get } from 'svelte/store';
import { bindItemLink } from './item-link-live';
import {
  itemHref,
  itemIdFromHref,
  itemLinkMarkdown,
  itemLinkTitle,
} from './item-links';
import { items } from './stores';

/**
 * A link to another item, shown in the visual editor as a chip carrying the
 * target's current title. It reads and writes the plain markdown link
 * described in lib/item-links.ts, so the Markdown tab and other apps see an
 * ordinary link.
 */
export const ItemLink = Node.create({
  name: 'itemLink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: '' },
      // The text stored with the link; shown only when the target is gone.
      title: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        // Above the Link mark's `a[href]` rule, which would otherwise claim
        // these as ordinary links.
        priority: 60,
        tag: 'a[href^="#/item/"]',
        getAttrs: (el) => {
          const id = itemIdFromHref(el.getAttribute('href'));
          return id ? { id, title: el.textContent ?? '' } : false;
        },
      },
    ];
  },

  renderHTML({ node }) {
    return [
      'a',
      {
        class: 'item-link',
        href: itemHref(node.attrs.id),
        'data-item-id': node.attrs.id,
      },
      node.attrs.title,
    ];
  },

  renderText({ node }) {
    return node.attrs.title;
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('a');
      dom.className = 'item-link';
      dom.href = itemHref(node.attrs.id);
      dom.dataset.itemId = node.attrs.id;
      const destroy = bindItemLink(dom, node.attrs.id, node.attrs.title);
      return {
        dom,
        destroy,
        // A click follows the link (handled app-wide, see App.svelte). Keep
        // it from the editor, where the Link extension would also open the
        // address in a new tab.
        stopEvent: (event) => event.type === 'mousedown',
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write(text: string): void },
          node: { attrs: { id: string; title: string } },
        ) {
          // Save the current title, so the stored text stays a useful
          // fallback after the target is renamed.
          const target = get(items)[node.attrs.id];
          state.write(
            itemLinkMarkdown(
              target ? itemLinkTitle(target) : node.attrs.title,
              node.attrs.id,
            ),
          );
        },
        parse: {},
      },
    };
  },
});
