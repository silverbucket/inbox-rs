<script lang="ts">
  import type { InboxItem, Collection, CollectionGroup } from '@inbox-rs/rs-module';
  import { storeItem } from '../lib/stores';
  import { cleanForStorage } from '../lib/clean-for-storage';
  import { typeIconPath } from '../lib/item-utils';

  let { todo, collection, group, onselect, onaddincollection }: {
    todo: InboxItem;
    /** The collection this todo belongs to, or null when unfiled. */
    collection: Collection | null;
    /** The group the collection belongs to, or null when unfiled. */
    group: CollectionGroup | null;
    onselect: (item: InboxItem) => void;
    /** Optional quick-add handler: opens the add-todo modal pre-targeted at
        this row's collection. Unfiled rows pass `undefined` so the follow-up
        stays unfiled too. Omit the handler to hide the affordance. */
    onaddincollection?: (collectionId: string | undefined) => void;
  } = $props();

  // Show the underlying item type as an icon for items that are "todos by flag"
  // (e.g. an isTodo bookmark) — for pure `type: 'todo'` items the checkbox is
  // already the type indicator, so skip the badge.
  const showTypeIcon = $derived(todo.type !== 'todo');
  const typeLabel = $derived(todo.type.charAt(0).toUpperCase() + todo.type.slice(1));
  const typeIconSvg = $derived(typeIconPath(todo.type));
  // TodoRow only renders todos. A todo without a collection is unfiled and can
  // be organized later.
  const collectionName = $derived(collection?.name ?? 'Unfiled');
  // Group and collection colours are exposed as separate CSS custom properties
  // so hierarchy is legible at a glance: the pill border and row hover tint
  // take the *group* colour, and the pill dot takes the *collection* colour.
  // That way two collections named "Misc" under different groups share a dot
  // but sit inside differently-bordered pills — you can tell them apart
  // without reading the name. Missing colours degrade to text-muted.
  const groupColor = $derived(group?.color || 'var(--text-muted)');
  const collectionColor = $derived(collection?.color || 'var(--text-muted)');
  const isUnfiled = $derived(!collection);

  // Human-friendly relative date — "today", "yesterday", "3d ago", or the date.
  // Designed to fit in the horizontal toolbar without wrapping on desktop.
  function formatRelative(iso: string | undefined): string {
    if (!iso) return '';
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return '';
    const diffMs = Date.now() - then.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const createdLabel = $derived(formatRelative(todo.createdAt));
  const createdTitle = $derived(new Date(todo.createdAt).toLocaleString());

  async function toggleCompleted(e: Event) {
    e.stopPropagation();
    const nowCompleted = !todo.completed;
    const updated = {
      ...todo,
      isTodo: true,
      completed: nowCompleted,
      completedAt: nowCompleted ? new Date().toISOString() : undefined,
    };
    await storeItem(cleanForStorage(updated) as InboxItem);
  }

  function handleClick(e: MouseEvent) {
    // Don't open the view modal when clicking the checkbox or its label.
    const target = e.target as HTMLElement;
    if (target.closest('input, button, a')) return;
    onselect(todo);
  }

  const quickAddTarget = $derived(todo.collectionId);

  function handleQuickAdd(e: Event) {
    e.stopPropagation();
    onaddincollection?.(quickAddTarget);
  }

  function handleKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    // "+" shortcut triggers quick-add for this row's collection, regardless
    // of which focusable descendant has focus — this is the keyboard path for
    // the hover-reveal button so you don't have to tab to it for each new
    // todo in a run.
    if (onaddincollection && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      onaddincollection(quickAddTarget);
      return;
    }
    // Enter/Space opens the view modal — but only when the row itself is the
    // key target. If the checkbox or quick-add button is focused, let them
    // handle their own activation.
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'A') return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onselect(todo);
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<li
  class="todo-row"
  class:completed={todo.completed}
  class:unfiled={isUnfiled}
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={handleKey}
  style="--group-color: {groupColor}; --collection-color: {collectionColor}"
>
  <input
    type="checkbox"
    class="checkbox"
    checked={todo.completed}
    onclick={(e) => e.stopPropagation()}
    onchange={toggleCompleted}
    aria-label="Mark {todo.title} as {todo.completed ? 'incomplete' : 'complete'}"
  />

  <span class="title">{todo.title}</span>

  <!-- The meta block collapses to line 2 on narrow screens via CSS;
       on desktop it sits inline on the right side of the row. -->
  <div class="meta">
    <span class="collection-pill" title="{collectionName}">
      <span class="pill-dot"></span>
      <span class="pill-name">{collectionName}</span>
    </span>
    {#if showTypeIcon}
      <span class="type-pill" title={typeLabel} aria-label={typeLabel}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          {@html typeIconSvg}
        </svg>
      </span>
    {/if}
    {#if createdLabel}
      <span class="date" title={createdTitle}>{createdLabel}</span>
    {/if}
  </div>

  {#if onaddincollection}
    <!-- Hover/focus-reveal quick-add: creates a new todo in this row's
         collection. Also triggerable via "+" keyboard shortcut when the row
         has focus, so keyboard users don't need to tab to the button. -->
    <button type="button"
      class="btn-quick-add"
      onclick={handleQuickAdd}
      aria-label="Add todo to {collectionName}"
      title="Add todo to {collectionName} (+)"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </button>
  {/if}
</li>

<style>
  .todo-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.55rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 150ms, border-color 150ms, box-shadow 150ms;
    -webkit-tap-highlight-color: transparent;
    min-width: 0;
  }

  /* Row-level tint uses the *group* colour so scanning down a list groups
     visually by hierarchy rather than by individual collection. */
  .todo-row:hover {
    background: color-mix(in srgb, var(--group-color) 6%, var(--surface) 94%);
    border-color: color-mix(in srgb, var(--group-color) 30%, var(--border) 70%);
  }

  .todo-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .checkbox {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    /* Checkbox picks up the *collection* colour — it's the most specific
       signal available for this individual todo. */
    accent-color: var(--collection-color);
    cursor: pointer;
  }

  .title {
    font-size: 0.92rem;
    color: var(--text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .todo-row.completed .title {
    text-decoration: line-through;
    opacity: 0.5;
  }

  /* On desktop the meta row is inline — title takes the free horizontal space,
     meta floats right. The CSS below flips this to a stacked 2-line layout on
     narrow screens. */
  .meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  /* The collection pill encodes hierarchy in two colour channels:
       - border + tinted background = group colour (which group this lives in)
       - dot = collection colour (which specific collection within the group)
     Together they disambiguate same-named collections across groups. */
  .collection-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    padding: 0.15rem 0.55rem;
    border: 1px solid color-mix(in srgb, var(--group-color) 35%, var(--border) 65%);
    background: color-mix(in srgb, var(--group-color) 8%, transparent 92%);
    border-radius: 999px;
    max-width: 12rem;
    min-width: 0;
  }

  .unfiled .collection-pill {
    border-style: dashed;
  }

  .pill-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--collection-color);
    flex-shrink: 0;
  }

  .pill-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Type icon pill: round badge with an SVG glyph indicating the underlying
     item type (bookmark, note, image, etc.). Visually sits between the
     collection tag and the date so the row reads [collection] [type] [date]. */
  .type-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--text-muted);
    background: var(--surface-tint);
    border: 1px solid var(--border);
    border-radius: 50%;
    flex-shrink: 0;
  }

  .date {
    font-size: 0.72rem;
    color: var(--text-muted);
    opacity: 0.75;
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* Quick-add button: revealed on hover or keyboard focus anywhere in the row
     (mirrors the pattern in GroupSection / CollectionView). Tinted with the
     collection colour to reinforce the "this adds here" mental model. */
  .btn-quick-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--collection-color) 35%, var(--border) 65%);
    background: color-mix(in srgb, var(--collection-color) 10%, var(--surface) 90%);
    color: var(--collection-color);
    cursor: pointer;
    opacity: 0;
    transition: opacity 150ms, background 150ms, border-color 150ms, transform 150ms;
    -webkit-tap-highlight-color: transparent;
  }

  .todo-row:hover .btn-quick-add,
  .todo-row:focus-within .btn-quick-add {
    opacity: 1;
  }

  .btn-quick-add:hover {
    background: color-mix(in srgb, var(--collection-color) 22%, var(--surface) 78%);
    border-color: var(--collection-color);
    transform: scale(1.05);
  }

  .btn-quick-add:focus-visible {
    opacity: 1;
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Touch devices: no hover state, so keep it always visible on a row-level
     alternative — but touch users already have the page-level "Add todo"
     button, so hide instead of clutter every row. */
  @media (hover: none) {
    .btn-quick-add {
      display: none;
    }
  }

  /* Narrow layout: flip row to a 2-line grid so title/check sit on line 1 and
     the meta (collection, type, date) wraps to line 2 aligned with the title.
     Keeps the checkbox anchored on the left like a normal 2-line list item. */
  @media (max-width: 600px) {
    .todo-row {
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto;
      column-gap: 0.6rem;
      row-gap: 0.25rem;
      align-items: start;
      padding: 0.55rem 0.65rem;
    }

    .checkbox {
      grid-column: 1;
      grid-row: 1 / span 2;
      align-self: center;
    }

    .title {
      grid-column: 2;
      grid-row: 1;
      font-size: 0.9rem;
    }

    .meta {
      grid-column: 2;
      grid-row: 2;
      gap: 0.4rem;
      flex-wrap: wrap;
    }

    .collection-pill {
      max-width: 10rem;
      font-size: 0.72rem;
      padding: 0.1rem 0.45rem;
    }

    .date {
      font-size: 0.68rem;
    }

    /* No room for the hover-reveal affordance in the 2-line grid — plus the
       narrow layout is typically touch anyway. The toolbar's Add-todo button
       is sufficient here. */
    .btn-quick-add {
      display: none;
    }
  }
</style>
