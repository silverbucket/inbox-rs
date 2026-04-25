<script lang="ts">
  import type { InboxItem, InboxItemType, Collection } from '@inbox-rs/rs-module';
  import {
    collectionItems,
    deleteItem,
    sortedGroups, moveCollectionToGroup,
    appConfig, updateConfig, reorderCollectionItems,
    groups,
  } from '../lib/stores';
  import { makeTodo } from '../lib/item-utils';
  import { slide, fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { dndzone } from 'svelte-dnd-action';
  import InboxCard from './InboxCard.svelte';
  import AddEntryBar from './AddEntryBar.svelte';
  import AddEntryModal from './AddEntryModal.svelte';
  import TodoRow from './TodoRow.svelte';

  let { collection, expanded = false, onselect, onedit, ontoggle, isTouchDevice = false }: {
    collection: Collection;
    expanded?: boolean;
    onselect: (item: InboxItem) => void;
    onedit: () => void;
    ontoggle: () => void;
    isTouchDevice?: boolean;
  } = $props();

  // Collection body renders both todos (at the top, drag-sortable) and
  // reference items (the existing masonry grid below) so the page keeps all
  // data in context while the flat Todos page shows the cross-collection view.
  const items = $derived($collectionItems[collection.id] ?? []);
  const todoItems = $derived(items.filter(i => i.isTodo || i.type === 'todo'));
  const openTodos = $derived(todoItems.filter(t => !t.completed));
  const completedTodos = $derived(
    todoItems.filter(t => t.completed)
      .slice()
      .sort((a, b) => new Date(b.completedAt ?? b.createdAt).getTime()
                     - new Date(a.completedAt ?? a.createdAt).getTime())
  );
  const referenceItems = $derived(items.filter(i => !i.isTodo && i.type !== 'todo'));

  // Shared group lookup for TodoRow styling — collection's own color takes
  // priority, but we also supply the group so the pill colour degrades
  // gracefully when a collection has no colour of its own.
  const group = $derived(
    collection.groupId ? ($groups[collection.groupId] ?? null) : null
  );

  // Reuse the global "show completed todos" flag so toggling it here stays in
  // sync with the flat Todos page — users have a single "show completed work"
  // preference rather than N per-collection toggles.
  const completedExpanded = $derived($appConfig.completedTodosExpanded === true);

  let addingType = $state<InboxItemType | null>(null);
  let showMoveMenu = $state(false);
  let moveButtonEl = $state<HTMLButtonElement>();
  let menuPos = $state({ top: 0, right: 0 });

  const availableGroups = $derived($sortedGroups);

  function toggleMoveMenu(e: Event) {
    e.stopPropagation();
    if (!showMoveMenu && moveButtonEl) {
      const rect = moveButtonEl.getBoundingClientRect();
      menuPos = {
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      };
    }
    showMoveMenu = !showMoveMenu;
  }

  async function handleMoveToGroup(groupId: string) {
    showMoveMenu = false;
    await moveCollectionToGroup(collection.id, groupId);
  }

  // ---- Drag-and-drop reordering of open todos ----
  let dndOpen = $state<Array<InboxItem & { id: string }>>([]);
  $effect(() => {
    dndOpen = openTodos.map(t => ({ ...t }));
  });

  function handleDndConsider(e: CustomEvent<{ items: Array<InboxItem & { id: string }> }>) {
    dndOpen = e.detail.items;
  }

  async function handleDndFinalize(e: CustomEvent<{ items: Array<InboxItem & { id: string }> }>) {
    const previous = openTodos.map(t => ({ ...t }));
    dndOpen = e.detail.items;
    const newOpenIds = dndOpen.map(t => t.id);
    try {
      // Splice the new open-todo order into itemIds while preserving the
      // relative order of completed todos and reference items — otherwise a
      // drag of a single open todo would also scramble the refs grid.
      const openIds = new Set(openTodos.map(t => t.id));
      const rest = collection.itemIds.filter(id => !openIds.has(id));
      await reorderCollectionItems(collection.id, [...newOpenIds, ...rest]);
    } catch (error) {
      console.error('Failed to reorder collection todos', error);
      dndOpen = previous;
    }
  }

  async function toggleCompletedSection() {
    try {
      await updateConfig({ completedTodosExpanded: !completedExpanded });
    } catch (error) {
      console.error('Failed to toggle completed todos', error);
    }
  }
</script>

<div class="collection" style="--col-color: {collection.color || '#6366f1'}" class:expanded>
  <!-- Header bar -->
  <div
    class="collection-header"
    role="button"
    tabindex="0"
    onclick={ontoggle}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ontoggle(); } }}
    aria-expanded={expanded}
    aria-label="{expanded ? 'Collapse' : 'Expand'} {collection.name}"
  >
    <span class="color-indicator"></span>
    <svg class="chevron" class:open={expanded} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
    <div class="header-info">
      <h3>{collection.name}</h3>
      {#if collection.description && !expanded}
        <span class="col-description">{collection.description}</span>
      {/if}
    </div>
    <div class="header-badges">
      {#if openTodos.length > 0}
        <span class="badge badge-todos" title="{openTodos.length} open {openTodos.length === 1 ? 'todo' : 'todos'}">
          {openTodos.length}
        </span>
      {/if}
      {#if referenceItems.length > 0}
        <span class="badge badge-ref" title="{referenceItems.length} {referenceItems.length === 1 ? 'item' : 'items'}">
          {referenceItems.length}
        </span>
      {:else if openTodos.length === 0}
        <span class="badge badge-ref">0</span>
      {/if}
    </div>
    <div class="header-actions">
      <button class="btn-header" onclick={(e) => { e.stopPropagation(); onedit(); }} aria-label="Edit collection" title="Edit">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
      {#if availableGroups.length > 0}
        <div class="move-menu-wrapper">
          <button class="btn-header" bind:this={moveButtonEl} aria-label="Move to group" aria-haspopup="menu" aria-expanded={showMoveMenu} title="Move to group" onclick={toggleMoveMenu}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <polyline points="9 14 12 11 15 14"></polyline>
            </svg>
          </button>
          {#if showMoveMenu}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="move-menu-backdrop" onclick={(e) => { e.stopPropagation(); showMoveMenu = false; }}></div>
            <div class="move-menu" style="top: {menuPos.top}px; right: {menuPos.right}px;" onclick={(e) => e.stopPropagation()}>
              <div class="move-menu-label">Move to group</div>
              {#each availableGroups as g (g.id)}
                <button
                  class="move-menu-item"
                  class:current={collection.groupId === g.id}
                  onclick={() => handleMoveToGroup(g.id)}
                  disabled={collection.groupId === g.id}
                >
                  <span class="move-dot" style="background: {g.color || 'var(--accent)'}"></span>
                  {g.name}
                  {#if collection.groupId === g.id}
                    <svg class="check-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Expanded body: Todos section (drag-sortable) and References section,
       each with a simple header + inline add affordance. Both sections are
       always rendered when expanded so users have a consistent path to add
       new items regardless of current contents — empty states sit quietly
       under the headers instead of replacing them. -->
  {#if expanded}
    <div class="collection-body" transition:slide={{ duration: isTouchDevice ? 0 : 200 }}>
      <section class="todos-section" aria-label="Todos in {collection.name}">
        <div class="section-header">
          <h4>Todos</h4>
          <button class="btn-inline" onclick={() => addingType = 'todo'} title="Add todo" aria-label="Add todo to {collection.name}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add
          </button>
        </div>

        {#if dndOpen.length > 0}
          <ul
            class="todo-list" role="list"
            use:dndzone={{
              items: dndOpen,
              flipDurationMs: 200,
              dropTargetStyle: {},
              dragDisabled: isTouchDevice,
              type: `todos-collection-${collection.id}`,
            }}
            onconsider={handleDndConsider}
            onfinalize={handleDndFinalize}
          >
            {#each dndOpen as todo (todo.id)}
              <div animate:flip={{ duration: 200 }} in:fade={{ duration: 180 }} out:fade={{ duration: 120 }}>
                <TodoRow {todo} {collection} {group} {onselect} />
              </div>
            {/each}
          </ul>
        {:else if completedTodos.length === 0}
          <p class="section-empty">No todos yet.</p>
        {/if}

        {#if completedTodos.length > 0}
          <button
            class="btn-completed-toggle"
            onclick={toggleCompletedSection}
            aria-expanded={completedExpanded}
          >
            <svg class="chevron-sm" class:open={completedExpanded} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            {completedTodos.length} completed
          </button>
          {#if completedExpanded}
            <ul class="todo-list completed-list" role="list" transition:slide={{ duration: isTouchDevice ? 0 : 200 }}>
              {#each completedTodos as todo (todo.id)}
                <div in:fade={{ duration: 150 }}>
                  <TodoRow {todo} {collection} {group} {onselect} />
                </div>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>

      <section class="references-section" aria-label="References in {collection.name}">
        <div class="section-header">
          <h4>References</h4>
          <!-- Omit 'todo' — the Todos section above owns that flow, and
               keeping it here would give two disagreeing entry points in
               the same view. -->
          <AddEntryBar onadd={(type) => addingType = type} excludeTypes={['todo']} />
        </div>

        {#if referenceItems.length > 0}
          <div class="grid">
            {#each referenceItems as item (item.id)}
              <div class="grid-card-wrapper">
                <InboxCard {item} {onselect} />
                <div class="card-actions">
                  <button class="btn-card-action" onclick={() => makeTodo(item)} title="Move to todos" aria-label="Make todo">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="section-empty">No references yet.</p>
        {/if}
      </section>
    </div>
  {/if}
</div>

{#if addingType}
  <AddEntryModal
    type={addingType}
    collectionId={collection.id}
    onclose={() => addingType = null}
    ondelete={async (item) => { await deleteItem(item.id, item); addingType = null; }}
  />
{/if}

<style>
  /* ================================================================
     COLLECTION — mirrors the inbox page layout when expanded
     ================================================================ */
  .collection {
    --_col: var(--col-color);
    border-radius: var(--radius);
    transition: box-shadow 250ms ease;
  }

  @media (pointer: fine) {
    .collection {
      overflow: hidden;
    }
  }

  .collection.expanded {
    box-shadow:
      0 1px 0 0 color-mix(in srgb, var(--_col) 20%, transparent 80%),
      0 4px 24px -4px var(--shadow);
  }

  /* ---- Header bar ---- */
  .collection-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    cursor: pointer;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    transition: background 150ms, border-color 150ms, border-radius 200ms;
    min-height: 3rem;
    -webkit-tap-highlight-color: transparent;
  }

  .expanded .collection-header {
    border-radius: var(--radius) var(--radius) 0 0;
    border-bottom-color: transparent;
  }

  .collection-header:hover {
    border-color: color-mix(in srgb, var(--_col) 40%, var(--border) 60%);
  }

  .color-indicator {
    width: 4px;
    align-self: stretch;
    min-height: 1.25rem;
    border-radius: 2px;
    background: var(--_col);
    flex-shrink: 0;
  }

  .chevron {
    flex-shrink: 0;
    transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1);
    color: var(--text-muted);
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .header-info {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  h3 {
    font-size: 0.95rem;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .col-description {
    font-size: 0.78rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    opacity: 0.7;
  }

  .header-badges {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.68rem;
    font-weight: 600;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    line-height: 1.3;
  }

  .badge-ref {
    color: var(--text-muted);
    background: color-mix(in srgb, var(--text-muted) 12%, transparent 88%);
    font-weight: 500;
  }

  /* Separate open-todo badge so the colored count reads as "active work" and
     doesn't blend into the neutral reference count. */
  .badge-todos {
    color: white;
    background: var(--_col);
  }

  .header-actions {
    display: flex;
    gap: 0.15rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 150ms;
  }

  .collection-header:hover .header-actions {
    opacity: 1;
  }

  /* On touch devices, always show actions */
  @media (hover: none) {
    .header-actions {
      opacity: 1;
    }
  }

  .btn-header {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 150ms, background 150ms;
    -webkit-tap-highlight-color: transparent;
  }

  .btn-header:hover {
    color: var(--text);
    background: var(--surface-tint);
  }

  .btn-header:active {
    background: var(--surface-tint-hover);
  }

  /* ---- Move menu (dropdown) ---- */
  .move-menu-wrapper {
    position: relative;
  }

  .move-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 49;
  }

  .move-menu {
    position: fixed;
    z-index: 50;
    min-width: 180px;
    padding: 0.35rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px var(--shadow);
  }

  .move-menu-label {
    font-size: 0.65rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    padding: 0.3rem 0.5rem 0.2rem;
  }

  .move-menu-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.5rem;
    border: none;
    background: none;
    color: var(--text);
    font-size: 0.82rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 120ms;
    text-align: left;
    min-height: 2.25rem;
  }

  .move-menu-item:hover:not(:disabled) {
    background: var(--accent-subtler);
  }

  .move-menu-item:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .move-menu-item.current {
    color: var(--text-muted);
  }

  .move-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .check-icon {
    margin-left: auto;
    color: var(--accent);
    flex-shrink: 0;
  }

  /* ================================================================
     EXPANDED BODY — dark background so cards pop (like inbox page)
     ================================================================ */
  .collection-body {
    background: var(--bg);
    border: 1px solid var(--border);
    border-top: 1px solid color-mix(in srgb, var(--_col) 15%, var(--border) 85%);
    border-radius: 0 0 var(--radius) var(--radius);
    padding: 1.25rem;
  }

  /* ---- Section framing (Todos + References share the same pattern) ---- */
  .todos-section {
    margin-bottom: 1.25rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    /* Allow the add-strip to shrink/scroll rather than push the title out. */
    min-width: 0;
  }

  .section-header h4 {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin: 0;
    flex-shrink: 0;
  }

  /* The references header hosts the AddEntryBar directly — give it room to
     shrink with horizontal scroll so a long button strip doesn't break the
     layout on narrow screens. */
  .references-section .section-header {
    gap: 0.5rem;
  }

  .references-section .section-header :global(.add-strip) {
    min-width: 0;
    flex-shrink: 1;
  }

  .section-empty {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin: 0.25rem 0 0.15rem;
    opacity: 0.75;
  }

  .btn-inline {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 0.25rem 0.55rem;
    cursor: pointer;
    transition: color 150ms, border-color 150ms;
    flex-shrink: 0;
  }

  .btn-inline:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .todo-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .completed-list {
    margin-top: 0.4rem;
    opacity: 0.75;
  }

  .btn-completed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 0.4rem 0.3rem;
    margin-top: 0.6rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: color 150ms;
  }

  .btn-completed-toggle:hover {
    color: var(--text);
  }

  .chevron-sm {
    color: var(--text-muted);
    transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
    transform: rotate(-90deg);
    flex-shrink: 0;
  }

  .chevron-sm.open {
    transform: rotate(0);
  }

  /* ---- Reference grid (masonry — same as InboxGrid) ---- */
  .grid {
    column-count: 3;
    column-gap: 1rem;
  }

  .grid-card-wrapper {
    break-inside: avoid;
    margin-bottom: 1rem;
    position: relative;
  }

  .card-actions {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    display: flex;
    gap: 0.2rem;
    opacity: 0;
    transition: opacity 150ms;
  }

  .grid-card-wrapper:hover .card-actions {
    opacity: 1;
  }

  @media (hover: none) {
    .card-actions {
      opacity: 1;
    }
  }

  .btn-card-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
    transition: color 150ms, background 150ms;
    box-shadow: 0 1px 4px var(--shadow);
  }

  .btn-card-action:hover {
    color: var(--accent);
    background: var(--bg);
  }

  /* ================================================================
     RESPONSIVE — mobile-first breakpoints
     ================================================================ */

  /* Stacked layout on mobile + tablet */
  @media (max-width: 900px) {
    .grid {
      column-count: 2;
    }
  }

  @media (max-width: 768px) {
    .collection-body {
      padding: 1rem;
    }

    .col-description {
      display: none;
    }
  }

  @media (max-width: 550px) {
    .grid {
      column-count: 1;
    }

    .collection-header {
      padding: 0.65rem 0.75rem;
    }

    .collection-body {
      padding: 0.75rem;
    }
  }
</style>
