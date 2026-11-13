<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import Placeholder from '@tiptap/extension-placeholder';
  import 'highlight.js/styles/github-dark.min.css';
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { itemLinkTitle, matchItemLinkTrigger } from '../lib/item-links';
  import { kindOf } from '../lib/kinds';
  import { createMarkdownEditorExtensions } from '../lib/markdown-editor';
  import { isTodoLike, parseQuery, searchItemsWithTerms } from '../lib/search';
  import { collections, items } from '../lib/stores';

  let {
    value = $bindable(''),
    placeholder = 'Write your note...',
    focusOnMount = false,
    selfId = undefined,
  }: {
    value: string;
    placeholder?: string;
    focusOnMount?: boolean;
    /** The item being edited, left out of the item-link picker. */
    selfId?: string;
  } = $props();

  // ---- Item-link picker ----
  // Typing `[[` opens a list of items; picking one replaces the `[[query`
  // with a link to it (see lib/item-links.ts).
  const PICKER_LIMIT = 8;
  /** The `[[query` being typed: its document range and the query text. */
  let trigger = $state<{ from: number; to: number; query: string } | null>(null);
  let pickerIndex = $state(0);
  let pickerPos = $state({ left: 0, top: 0, bottom: 0 });
  // Where the user dismissed the picker with Escape; it stays closed until
  // a new `[[` is typed somewhere else.
  let dismissedFrom = -1;

  const pickerItems = $derived.by((): InboxItem[] => {
    if (!trigger) return [];
    const all = Object.values($items).filter((item) => item.id !== selfId);
    const terms = parseQuery(trigger.query);
    if (terms.length === 0) {
      // Nothing typed yet: offer the newest items.
      return all
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, PICKER_LIMIT);
    }
    return searchItemsWithTerms(all, terms, $collections)
      .slice(0, PICKER_LIMIT)
      .map((result) => result.item);
  });
  const pickerOpen = $derived(trigger !== null && pickerItems.length > 0);

  $effect(() => {
    if (pickerIndex >= pickerItems.length) pickerIndex = 0;
  });

  function refreshTrigger(e: Editor) {
    const { $from: cursor, empty } = e.state.selection;
    const before =
      empty && !cursor.parent.type.spec.code
        ? cursor.parent.textBetween(0, cursor.parentOffset, undefined, '\ufffc')
        : '';
    const match = matchItemLinkTrigger(before);
    if (!match) {
      trigger = null;
      dismissedFrom = -1;
      return;
    }
    const from = cursor.pos - match.length;
    if (from === dismissedFrom) {
      trigger = null;
      return;
    }
    if (trigger?.query !== match.query) pickerIndex = 0;
    trigger = { from, to: cursor.pos, query: match.query };
    const caret = e.view.coordsAtPos(cursor.pos);
    pickerPos = { left: caret.left, top: caret.top, bottom: caret.bottom };
  }

  function pickItem(item: InboxItem) {
    if (!editor || !trigger) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: trigger.from, to: trigger.to }, [
        { type: 'itemLink', attrs: { id: item.id, title: itemLinkTitle(item) } },
        { type: 'text', text: ' ' },
      ])
      .run();
    trigger = null;
  }

  /** Keys the picker takes over while it is open. */
  function handlePickerKey(event: KeyboardEvent): boolean {
    if (!pickerOpen || !trigger) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      pickerIndex =
        (pickerIndex + step + pickerItems.length) % pickerItems.length;
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      pickItem(pickerItems[pickerIndex]);
    } else if (event.key === 'Escape') {
      dismissedFrom = trigger.from;
      trigger = null;
    } else {
      return false;
    }
    // Escape must close only the picker, not the card around the editor.
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  /** Start an item link at the cursor (the "Link item" button). */
  export function linkItem() {
    editor?.chain().focus().insertContent('[[').run();
  }

  // Keep the list on screen: below the caret, or above it near the bottom
  // edge; clamped so it never runs off the right side.
  const pickerStyle = $derived.by(() => {
    const width = Math.min(340, window.innerWidth - 16);
    const left = Math.max(8, Math.min(pickerPos.left, window.innerWidth - width - 8));
    const below = window.innerHeight - pickerPos.bottom;
    const vertical =
      below < 280 && pickerPos.top > below
        ? `bottom: ${window.innerHeight - pickerPos.top + 4}px`
        : `top: ${pickerPos.bottom + 4}px`;
    return `left: ${left}px; width: ${width}px; ${vertical};`;
  });

  // Bound via `bind:this` below — populated after mount, so the type is
  // optional and `onMount` returns early if the bind hasn't resolved yet
  // (it always has by the time onMount fires, but keeping the type honest
  // avoids the non-null assertion hack).
  let editorElement = $state<HTMLDivElement>();
  let editor: Editor | null = null;

  onMount(() => {
    if (!editorElement) return;
    editor = new Editor({
      element: editorElement,
      extensions: [
        ...createMarkdownEditorExtensions(),
        Placeholder.configure({
          placeholder,
        }),
      ],
      content: value,
      autofocus: focusOnMount ? 'end' : false,
      onUpdate: ({ editor: e }) => {
        value = (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
      },
      onSelectionUpdate: ({ editor: e }) => refreshTrigger(e),
      onTransaction: ({ editor: e, transaction }) => {
        if (transaction.docChanged) refreshTrigger(e);
      },
      onBlur: () => {
        trigger = null;
      },
      editorProps: {
        attributes: {
          class: 'tiptap-editor',
        },
        handleKeyDown: (_view, event) => handlePickerKey(event),
      },
    });
  });

  onDestroy(() => {
    editor?.destroy();
  });

  // Keep the visual editor in sync with external markdown updates.
  $effect(() => {
    if (!editor) {
      return;
    }

    const currentMd = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
    if (currentMd !== value) {
      editor.commands.setContent(value);
    }
  });
</script>

<div class="editor-container">
  <div class="tiptap-wrap" bind:this={editorElement}></div>
  {#if pickerOpen}
    <!-- Focus stays in the editor; the list is driven from its keydown. -->
    <ul class="item-picker" role="listbox" aria-label="Link to an item" style={pickerStyle}>
      {#each pickerItems as item, i (item.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          role="option"
          aria-selected={i === pickerIndex}
          class:active={i === pickerIndex}
          onmousedown={(e) => e.preventDefault()}
          onmouseenter={() => (pickerIndex = i)}
          onclick={() => pickItem(item)}
        >
          <span class="item-picker-title">{itemLinkTitle(item)}</span>
          <span class="item-picker-meta">
            {isTodoLike(item) ? 'Todo' : kindOf(item.type).label}{item.collectionId && $collections[item.collectionId]
              ? ` · ${$collections[item.collectionId].name}`
              : ''}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .editor-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .item-picker {
    position: fixed;
    z-index: 400;
    max-height: 17rem;
    margin: 0;
    padding: 0.25rem;
    overflow-y: auto;
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  }
  .item-picker li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.4rem 0.55rem;
    border-radius: calc(var(--radius-sm) - 2px);
    cursor: pointer;
  }
  .item-picker li.active {
    background: var(--accent-subtle);
  }
  .item-picker-title {
    overflow: hidden;
    font-size: 0.88rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-picker-meta {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 0.72rem;
  }

  .tiptap-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow-y: auto;
  }

  .tiptap-wrap :global(.tiptap-editor) {
    flex: 1;
    padding: 0.75rem;
    outline: none;
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--text);
    min-height: 100%;
  }

  .tiptap-wrap:focus-within {
    border-color: var(--accent);
  }

  .tiptap-wrap :global(.tiptap-editor p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    color: var(--text-muted);
    opacity: 0.5;
    pointer-events: none;
    float: left;
    height: 0;
  }

  /* Headings */
  .tiptap-wrap :global(h1) { font-size: 1.3rem; font-weight: 600; margin: 0.75rem 0 0.4rem; }
  .tiptap-wrap :global(h2) { font-size: 1.15rem; font-weight: 600; margin: 0.6rem 0 0.35rem; }
  .tiptap-wrap :global(h3) { font-size: 1.05rem; font-weight: 600; margin: 0.5rem 0 0.3rem; }
  .tiptap-wrap :global(h4),
  .tiptap-wrap :global(h5),
  .tiptap-wrap :global(h6) { font-size: 0.95rem; font-weight: 600; margin: 0.4rem 0 0.25rem; }

  /* Lists */
  .tiptap-wrap :global(ul),
  .tiptap-wrap :global(ol) {
    padding-left: 1.5rem;
    margin: 0.25rem 0;
  }
  .tiptap-wrap :global(ul) { list-style: disc; }
  .tiptap-wrap :global(ol) { list-style: decimal; }
  .tiptap-wrap :global(li) { margin-bottom: 0.1rem; }
  .tiptap-wrap :global(li p) { margin: 0; }

  /* Blockquote */
  .tiptap-wrap :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 0.75rem;
    margin: 0.4rem 0;
    color: var(--text-muted);
  }
  .tiptap-wrap :global(blockquote p) { margin: 0; }

  /* Inline code */
  .tiptap-wrap :global(code) {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.82rem;
  }

  /* Code blocks */
  .tiptap-wrap :global(pre) {
    background: #0d1117;
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    margin: 0.4rem 0;
    overflow-x: auto;
  }
  .tiptap-wrap :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: #e6edf3;
  }

  /* Horizontal rule */
  .tiptap-wrap :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.75rem 0;
  }

  /* Strong & em */
  .tiptap-wrap :global(strong) { font-weight: 600; }
  .tiptap-wrap :global(em) { font-style: italic; }

  /* Paragraph spacing */
  .tiptap-wrap :global(p) { margin: 0 0 0.4rem; }
  .tiptap-wrap :global(p:last-child) { margin-bottom: 0; }
</style>
