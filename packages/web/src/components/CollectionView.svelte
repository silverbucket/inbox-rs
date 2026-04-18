<script lang="ts">
  import type { InboxItem, InboxItemType, Collection } from '@inbox-rs/rs-module';
  import { dndzone } from 'svelte-dnd-action';
  import {
    collectionItems, storeItem, storeCollection,
    deleteItem,
    sortedGroups, moveCollectionToGroup,
    reorderCollectionItems
  } from '../lib/stores';
  import { makeTodo, makeReference, typeBadge, todoNote } from '../lib/item-utils';
  import { cleanForStorage } from '../lib/clean-for-storage';
  import { slide } from 'svelte/transition';
  import InboxCard from './InboxCard.svelte';
  import AddEntryBar from './AddEntryBar.svelte';
  import AddEntryModal from './AddEntryModal.svelte';

  let { collection, expanded = false, onselect, onedit, ontoggle, isTouchDevice = false }: {
    collection: Collection;
    expanded?: boolean;
    onselect: (item: InboxItem) => void;
    onedit: () => void;
    ontoggle: () => void;
    isTouchDevice?: boolean;
  } = $props();

  const items = $derived($collectionItems[collection.id] ?? []);
  const todoItems = $derived(items.filter(i => i.isTodo || i.type === 'todo'));
  const openTodos = $derived(todoItems.filter(t => !t.completed));
  const completedTodos = $derived(todoItems.filter(t => t.completed));
  const referenceItems = $derived(items.filter(i => !i.isTodo && i.type !== 'todo'));

  let showCompleted = $state(false);
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

  async function handleMoveToGroup(groupId: string | undefined) {
    showMoveMenu = false;
    await moveCollectionToGroup(collection.id, groupId);
  }

  async function handleToggleActive(e: Event) {
    e.stopPropagation();
    await storeCollection({ ...collection, active: !collection.active });
  }

  async function toggleCompleted(e: Event, item: InboxItem) {
    e.stopPropagation();
    const nowCompleted = !item.completed;
    const updated = {
      ...item,
      isTodo: true,
      completed: nowCompleted,
      completedAt: nowCompleted ? new Date().toISOString() : undefined,
    };
    await storeItem(cleanForStorage(updated));
  }

  // DnD for open todos within the collection
  let dndOpenTodos = $state<Array<InboxItem & { id: string }>>([]);
  $effect(() => {
    dndOpenTodos = openTodos.map(t => ({ ...t }));
  });

  function handleTodoDndConsider(e: CustomEvent<{ items: Array<InboxItem & { id: string }> }>) {
    dndOpenTodos = e.detail.items;
  }

  async function handleTodoDndFinalize(e: CustomEvent<{ items: Array<InboxItem & { id: string }> }>) {
    const previous = openTodos.map(t => ({ ...t }));
    dndOpenTodos = e.detail.items;
    // Rebuild full itemIds: new open todo order + completed todos + reference items (preserving their relative order)
    const openTodoIds = new Set(openTodos.map(t => t.id));
    const newOpenIds = dndOpenTodos.map(t => t.id);
    const rest = collection.itemIds.filter(id => !openTodoIds.has(id));
    const newItemIds = [...newOpenIds, ...rest];
    try {
      await reorderCollectionItems(collection.id, newItemIds);
    } catch (error) {
      console.error('Failed to reorder collection todos', error);
      dndOpenTodos = previous;
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
    onkeydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ontoggle(); } }}
    aria-expanded={expanded}
    aria-label="{expanded ? 'Collapse' : 'Expand'} {collection.name}{collection.active ? ' (active)' : ''}"
  >
    <span class="color-indicator"></span>
    <svg class="chevron" class:open={expanded} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
    <div class="header-info">
      <h3>{collection.name}</h3>
      <button class="btn-header btn-edit" onclick={(e) => { e.stopPropagation(); onedit(); }} aria-label="Edit collection" title="Edit">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
      {#if collection.description && !expanded}
        <span class="col-description">{collection.description}</span>
      {/if}
    </div>
    <div class="header-badges">
      {#if openTodos.length > 0}
        <span class="badge badge-todo" title="{openTodos.length} open {openTodos.length === 1 ? 'todo' : 'todos'}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          {openTodos.length}
        </span>
      {/if}
      {#if referenceItems.length > 0}
        <span class="badge badge-ref" title="{referenceItems.length} {referenceItems.length === 1 ? 'item' : 'items'}">
          {referenceItems.length}
        </span>
      {/if}
      {#if items.length === 0}
        <span class="badge badge-ref">0</span>
      {/if}
    </div>
    <button
      type="button"
      class="header-toggle"
      class:on={collection.active}
      onclick={handleToggleActive}
      role="switch"
      aria-checked={collection.active ?? false}
      aria-label="{collection.active ? 'Deactivate' : 'Activate'} collection"
      title="{collection.active ? 'Active' : 'Inactive'} — click to toggle"
    >
      <span class="header-toggle-knob"></span>
    </button>
    <div class="header-actions">
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
              <button
                class="move-menu-item"
                class:current={!collection.groupId}
                onclick={() => handleMoveToGroup(undefined)}
                disabled={!collection.groupId}
              >
                <span class="move-dot" style="background: var(--text-muted)"></span>
                Collections
                {#if !collection.groupId}
                  <svg class="check-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                {/if}
              </button>
              <div class="move-menu-divider"></div>
              {#each availableGroups as group (group.id)}
                <button
                  class="move-menu-item"
                  class:current={collection.groupId === group.id}
                  onclick={() => handleMoveToGroup(group.id)}
                  disabled={collection.groupId === group.id}
                >
                  <span class="move-dot" style="background: {group.color || 'var(--accent)'}"></span>
                  {group.name}
                  {#if collection.groupId === group.id}
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

  <!-- Expanded body — mirrors the inbox page layout -->
  {#if expanded}
    <div class="collection-body" transition:slide={{ duration: isTouchDevice ? 0 : 200 }}>
      {#if items.length === 0}
        <div class="empty-state">
          <p>No items yet — create one below.</p>
          <div class="empty-actions">
            <AddEntryBar onadd={(type) => addingType = type} />
          </div>
        </div>
      {:else}
        <div class="content-layout" class:has-todos={todoItems.length > 0} class:has-refs={referenceItems.length > 0}>
          {#if todoItems.length > 0}
            <aside class="todo-panel">
              <div class="todo-header">
                <h4 class="todo-heading">Todos</h4>
                {#if openTodos.length > 0}
                  <span class="todo-badge">{openTodos.length}</span>
                {:else if todoItems.length > 0}
                  <span class="todo-count-label">0/{todoItems.length}</span>
                {/if}
              </div>

              {#if dndOpenTodos.length > 0}
                <ul class="todo-list" role="list"
                  use:dndzone={{ items: dndOpenTodos, flipDurationMs: 200, dropTargetStyle: {}, dragDisabled: isTouchDevice }}
                  onconsider={handleTodoDndConsider}
                  onfinalize={handleTodoDndFinalize}
                >
                  {#each dndOpenTodos as item (item.id)}
                    {@const badge = typeBadge(item)}
                    {@const note = todoNote(item)}
                    <li class="todo-item" role="button" tabindex="0"
                      onclick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('input, button')) return;
                        onselect(item);
                      }}
                      onkeydown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(item); }
                      }}>
                      <input
                        type="checkbox"
                        class="checkbox"
                        checked={false}
                        onclick={(e) => e.stopPropagation()}
                        onchange={(e) => toggleCompleted(e, item)}
                        aria-label="Mark {item.title} as complete"
                      />
                      <div class="todo-content">
                        <div class="todo-title-row">
                          <span class="todo-title">{item.title}</span>
                          <div class="todo-actions">
                            <button class="btn-action-icon" onclick={(e) => { e.stopPropagation(); makeReference(item); }} title="Move to references" aria-label="Make reference">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                              </svg>
                            </button>
                          </div>
                        </div>
                        {#if badge || note}
                          <div class="todo-meta">
                            {#if badge}<span class="type-badge">{badge}</span>{/if}
                            {#if note}<span class="todo-note">{note}</span>{/if}
                          </div>
                        {/if}
                      </div>
                    </li>
                  {/each}
                </ul>
              {:else if todoItems.length === 0}
                <p class="empty-sub">No todos yet.</p>
              {/if}

              {#if completedTodos.length > 0}
                <button class="btn-show-completed" onclick={() => showCompleted = !showCompleted}>
                  <svg class="chevron-sm" class:collapsed={!showCompleted} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                  {completedTodos.length} completed
                </button>
                {#if showCompleted}
                  <ul class="todo-list completed-list" role="list">
                    {#each completedTodos as item (item.id)}
                      {@const badge = typeBadge(item)}
                      {@const note = todoNote(item)}
                      <li class="todo-item completed" role="button" tabindex="0"
                        onclick={(e) => {
                          const target = e.target as HTMLElement;
                          if (target.closest('input, button')) return;
                          onselect(item);
                        }}
                        onkeydown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(item); }
                        }}>
                        <input
                          type="checkbox"
                          class="checkbox"
                          checked={true}
                          onclick={(e) => e.stopPropagation()}
                          onchange={(e) => toggleCompleted(e, item)}
                          aria-label="Mark {item.title} as incomplete"
                        />
                        <div class="todo-content">
                          <div class="todo-title-row">
                            <span class="todo-title">{item.title}</span>
                            <div class="todo-actions">
                              <button class="btn-action-icon" onclick={(e) => { e.stopPropagation(); makeReference(item); }} title="Move to references" aria-label="Make reference">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                                </svg>
                              </button>
                            </div>
                          </div>
                          {#if badge || note}
                            <div class="todo-meta">
                              {#if badge}<span class="type-badge">{badge}</span>{/if}
                              {#if note}<span class="todo-note">{note}</span>{/if}
                            </div>
                          {/if}
                        </div>
                      </li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </aside>
          {/if}

          {#if referenceItems.length > 0}
            <div class="ref-area">
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
            </div>
          {/if}
        </div>

        <div class="collection-toolbar">
          <AddEntryBar onadd={(type) => addingType = type} />
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if addingType}
  <AddEntryModal type={addingType} collectionId={collection.id} onclose={() => addingType = null} ondelete={async (item) => { await deleteItem(item.id, item); addingType = null; }} />
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

  .header-toggle {
    position: relative;
    width: 32px;
    height: 18px;
    border-radius: 999px;
    border: none;
    background: color-mix(in srgb, var(--text-muted) 25%, var(--bg) 75%);
    cursor: pointer;
    transition: background 200ms;
    flex-shrink: 0;
    padding: 0;
  }

  .header-toggle.on {
    background: var(--_col);
  }

  .header-toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .header-toggle.on .header-toggle-knob {
    transform: translateX(14px);
  }

  .btn-edit {
    width: 28px;
    height: 28px;
    opacity: 0;
    transition: opacity 150ms, color 150ms, background 150ms;
    flex-shrink: 0;
  }

  .collection-header:hover .btn-edit {
    opacity: 1;
  }

  @media (hover: none) {
    .btn-edit {
      opacity: 1;
    }
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
    margin-left: auto;
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

  .badge-todo {
    color: white;
    background: var(--_col);
  }

  .badge-ref {
    color: var(--text-muted);
    background: color-mix(in srgb, var(--text-muted) 12%, transparent 88%);
    font-weight: 500;
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

  .move-menu-divider {
    height: 1px;
    background: var(--border);
    margin: 0.25rem 0;
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

  /* ---- Content layout: sidebar + masonry grid (mirrors inbox) ---- */
  .content-layout {
    display: flex;
    gap: 1.5rem;
    align-items: flex-start;
  }

  /* ---- Todo panel (sidebar) ---- */
  .todo-panel {
    width: 280px;
    flex-shrink: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
  }

  .ref-area {
    flex: 1;
    min-width: 0;
  }

  /* ---- Todo list styles ---- */
  .todo-header {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .todo-heading {
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .todo-badge {
    font-size: 0.65rem;
    font-weight: 600;
    color: white;
    background: var(--accent);
    min-width: 18px;
    height: 18px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 5px;
    line-height: 1;
  }

  .todo-count-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    opacity: 0.7;
  }

  .todo-list {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .completed-list {
    margin-top: 0.25rem;
  }

  .todo-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0.4rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.1s;
    min-height: 2.5rem;
    -webkit-tap-highlight-color: transparent;
  }

  .todo-item:hover {
    background: var(--surface-tint);
  }

  .todo-item:active {
    background: var(--surface-tint-hover);
  }

  .todo-content {
    flex: 1;
    min-width: 0;
  }

  .todo-title-row {
    display: flex;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .todo-title {
    font-size: 0.9rem;
    flex: 1;
    min-width: 0;
    word-break: break-word;
  }

  .completed .todo-title {
    text-decoration: line-through;
    opacity: 0.5;
  }

  .todo-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.15rem;
  }

  .todo-note {
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .checkbox {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: var(--_col);
    cursor: pointer;
    margin-top: 1px;
  }

  .type-badge {
    font-size: 0.6rem;
    color: var(--accent);
    background: var(--accent-subtle);
    padding: 0.1rem 0.35rem;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .todo-actions {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .todo-item:hover .todo-actions {
    opacity: 1;
  }

  @media (hover: none) {
    .todo-actions {
      opacity: 1;
    }
  }

  .btn-action-icon {
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.3rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    transition: color 0.15s, background 0.15s;
    cursor: pointer;
    min-width: 28px;
    min-height: 28px;
    justify-content: center;
  }

  .btn-action-icon:hover {
    color: var(--accent);
    background: var(--accent-subtler);
  }

  .btn-show-completed {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 0.45rem 0.4rem;
    margin-top: 0.5rem;
    cursor: pointer;
    transition: color 0.15s;
    border-radius: var(--radius-sm);
    min-height: 2rem;
  }

  .btn-show-completed:hover {
    color: var(--text);
  }

  .chevron-sm {
    color: var(--text-muted);
    transition: transform 0.15s;
    flex-shrink: 0;
  }

  .chevron-sm.collapsed {
    transform: rotate(-90deg);
  }

  .empty-sub {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0.75rem 0 0;
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

  /* ---- Toolbar ---- */
  .collection-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 1.25rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  /* ---- Empty state ---- */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2rem 1rem;
    text-align: center;
  }

  .empty-state p {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .empty-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: center;
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
    .content-layout {
      flex-direction: column;
      gap: 1rem;
    }

    .todo-panel {
      width: 100%;
    }

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
      gap: 0.35rem;
    }

    .col-description {
      display: none;
    }

    .header-badges {
      display: none;
    }

    .header-toggle {
      margin-left: auto;
    }

    .collection-body {
      padding: 0.75rem;
    }
  }
</style>
