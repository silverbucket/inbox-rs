import type { InboxItem } from '@inbox-rs/rs-module';
import { get } from 'svelte/store';
import { itemLinkTitle } from './item-links';
import { items, restoring } from './stores';

/**
 * Show an item link as its target is now: the current title, or — once the
 * store has loaded and the target isn't in it — the stored text struck
 * through. `fallback` is the text saved with the link.
 */
function paint(
  link: HTMLElement,
  id: string,
  fallback: string,
  all: Record<string, InboxItem>,
  loading: boolean,
) {
  const target = all[id];
  const text = target ? itemLinkTitle(target) : fallback || 'Untitled';
  // Compare before writing: the rendered-markdown action below watches for
  // DOM changes, and an unconditional write would retrigger it forever.
  if (link.textContent !== text) link.textContent = text;
  const missing = !target && !loading;
  link.classList.toggle('missing', missing);
  if (missing) link.title = 'This item no longer exists';
  else link.removeAttribute('title');
}

/**
 * Keep one item link (an editor chip) in step with the items store.
 * Returns the unsubscribe function.
 */
export function bindItemLink(
  link: HTMLElement,
  id: string,
  fallback: string,
): () => void {
  const update = () => paint(link, id, fallback, get(items), get(restoring));
  const stops = [items.subscribe(update), restoring.subscribe(update)];
  return () => {
    for (const stop of stops) stop();
  };
}

/**
 * Svelte action for a container of rendered markdown: keeps every item link
 * inside it showing its target's current title, as the markdown is
 * re-rendered and as items are renamed or deleted.
 */
export function liveItemLinks(node: HTMLElement) {
  const fallbacks = new WeakMap<Element, string>();
  const update = () => {
    const all = get(items);
    const loading = get(restoring);
    for (const link of node.querySelectorAll<HTMLElement>(
      'a.item-link[data-item-id]',
    )) {
      if (!fallbacks.has(link)) fallbacks.set(link, link.textContent ?? '');
      paint(
        link,
        link.dataset.itemId ?? '',
        fallbacks.get(link) ?? '',
        all,
        loading,
      );
    }
  };
  const observer = new MutationObserver(update);
  observer.observe(node, { childList: true, subtree: true });
  const stops = [items.subscribe(update), restoring.subscribe(update)];
  return {
    destroy() {
      observer.disconnect();
      for (const stop of stops) stop();
    },
  };
}
