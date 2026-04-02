<script lang="ts">
  import type { InboxItem, Collection } from '@inbox-rs/rs-module';
  import {
    collectionItems, storeItem,
    removeItemFromCollection
  } from '../lib/stores';
  import { slide } from 'svelte/transition';
  import InboxCard from './InboxCard.svelte';
  import CollectionItemPicker from './CollectionItemPicker.svelte';

  let { collection, expanded = false, onselect, onedit, ondelete, ontoggle }: {
    collection: Collection;
    expanded?: boolean;
    onselect: (item: InboxItem) => void;
    onedit: () => void;
    ondelete: () => void;
    ontoggle: () => void;
  } = $props();

  const items = $derived($collectionItems[collection.id] ?? []);
  const todoItems = $derived(items.filter(i => i.isTodo || i.type === 'todo'));
  const openTodos = $derived(todoItems.filter(t => !t.completed));
  const completedTodos = $derived(todoItems.filter(t => t.completed));
  const referenceItems = $derived(items.filter(i => !i.isTodo && i.type !== 'todo'));
  const hasBoth = $derived(todoItems.length > 0 && referenceItems.length > 0);

  let showCompleted = $state(false);
  let showPicker = $state(false);

  async function toggleCompleted(e: Event, item: InboxItem) {
    e.stopPropagation();
    const nowCompleted = !item.completed;
    const updated = {
      ...item,
      isTodo: true,
      completed: nowCompleted,
      completedAt: nowCompleted ? new Date().toISOString() : undefined,
    };
    const clean = JSON.parse(JSON.stringify(updated));
    await storeItem(clean);
  }

  async function handleRemoveItem(itemId: string) {
    await removeItemFromCollection(itemId, collection.id);
  }

  async function makeTodo(item: InboxItem) {
    const updated = { ...item, isTodo: true, completed: false };
    delete (updated as any).completedAt;
    await storeItem(updated as InboxItem);
  }

  async function makeReference(item: InboxItem) {
    const updated = { ...item };
    delete (updated as any).isTodo;
    delete (updated as any).completed;
    delete (updated as any).completedAt;
    await storeItem(updated as InboxItem);
  }

  async function handlePickItem(item: InboxItem) {
    const { moveItemToCollection } = await import('../lib/stores');
    await moveItemToCollection(item.id, collection.id);
  }

  function typeBadge(item: InboxItem): string | null {
    return item.type === 'todo' ? null : item.type;
  }

  function todoNote(item: InboxItem): string | null {
    const notes = ('notes' in item ? (item as any).notes : null) || item.description || ('body' in item ? (item as any).body : null);
    if (!notes) return null;
    const firstLine = notes.split('\n')[0].trim();
    return firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;
  }
</script>

<div class="collection-card" style="--col-color: {collection.color || '#6366f1'}" class:expanded class:has-both={hasBoth} class:todo-only={todoItems.length > 0 && referenceItems.length === 0} class:ref-only={referenceItems.length > 0 && todoItems.length === 0}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="card-header" onclick={ontoggle}>
    <svg class="chevron" class:open={expanded} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
    <h3>{collection.name}</h3>
    <span class="item-count">{items.length}</span>
    {#if collection.description}
      <span class="col-description">{collection.description}</span>
    {/if}
    <div class="header-buttons">
      <button class="btn-icon" onclick={(e) => { e.stopPropagation(); showPicker = true; }} aria-label="Add items">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
      <button class="btn-icon" onclick={(e) => { e.stopPropagation(); onedit(); }} aria-label="Edit collection">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
      <button class="btn-icon btn-danger" onclick={(e) => { e.stopPropagation(); ondelete(); }} aria-label="Delete collection">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  </div>

  {#if expanded}
    <div class="card-body" transition:slide={{ duration: 250 }}>
      {#if items.length === 0}
        <div class="empty-items">
          <p>No items yet.</p>
          <button class="btn-action" onclick={() => showPicker = true}>Add Items from Inbox</button>
        </div>
      {:else}
        <div class="content-layout" class:has-todos={todoItems.length > 0}>
          <!-- Todo sidebar (left) — mirrors main page TodoList -->
          {#if todoItems.length > 0}
            <aside class="sidebar">
              <div class="todo-header">
                <h4 class="todo-heading">Todos</h4>
                {#if openTodos.length > 0}
                  <span class="todo-badge">{openTodos.length}</span>
                {:else if todoItems.length > 0}
                  <span class="todo-count-label">0/{todoItems.length}</span>
                {/if}
              </div>

              {#if openTodos.length > 0}
                <ul class="todo-list" role="list">
                  {#each openTodos as item (item.id)}
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
                          <button class="btn-action-icon" onclick={(e) => { e.stopPropagation(); makeReference(item); }} title="Move to references" aria-label="Make reference">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                            </svg>
                          </button>
                          <button class="btn-action-icon btn-action-danger" onclick={(e) => { e.stopPropagation(); handleRemoveItem(item.id); }} title="Remove from collection" aria-label="Remove">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        </div>
                        {#if badge || note}
                          <div class="todo-meta">
                            {#if badge}
                              <span class="type-badge">{badge}</span>
                            {/if}
                            {#if note}
                              <span class="todo-note">{note}</span>
                            {/if}
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
                            <button class="btn-action-icon" onclick={(e) => { e.stopPropagation(); makeReference(item); }} title="Move to references" aria-label="Make reference">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                              </svg>
                            </button>
                            <button class="btn-action-icon btn-action-danger" onclick={(e) => { e.stopPropagation(); handleRemoveItem(item.id); }} title="Remove from collection" aria-label="Remove">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                              </svg>
                            </button>
                          </div>
                          {#if badge || note}
                            <div class="todo-meta">
                              {#if badge}
                                <span class="type-badge">{badge}</span>
                              {/if}
                              {#if note}
                                <span class="todo-note">{note}</span>
                              {/if}
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

          <!-- Reference grid (right) — mirrors main page InboxGrid with masonry -->
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
                      <button class="btn-card-action btn-card-danger" onclick={() => handleRemoveItem(item.id)} title="Remove from collection" aria-label="Remove">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if showPicker}
  <CollectionItemPicker onclose={() => showPicker = false} onpick={handlePickItem} />
{/if}

<style>
  .collection-card {
    border: 1px solid var(--border);
    border-left: 3px solid var(--col-color);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
    transition: border-color 200ms, box-shadow 200ms;
  }

  .collection-card.expanded {
    border-left-width: 4px;
    box-shadow: 0 2px 12px color-mix(in srgb, var(--col-color) 15%, transparent 85%);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 0.75rem;
    cursor: pointer;
    transition: background 120ms;
    background: linear-gradient(90deg, color-mix(in srgb, var(--col-color) 6%, transparent 94%) 0%, transparent 40%);
  }

  .card-header:hover {
    background: linear-gradient(90deg, color-mix(in srgb, var(--col-color) 12%, transparent 88%) 0%, color-mix(in srgb, var(--col-color) 4%, transparent 96%) 100%);
  }

  .chevron {
    flex-shrink: 0;
    transition: transform 250ms ease;
    color: var(--text-muted);
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  h3 {
    font-size: 0.95rem;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: color-mix(in srgb, var(--text) 70%, var(--col-color) 30%);
  }

  .item-count {
    font-size: 0.7rem;
    color: var(--col-color);
    background: color-mix(in srgb, var(--col-color) 15%, transparent 85%);
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    flex-shrink: 0;
    font-weight: 600;
  }

  .col-description {
    font-size: 0.78rem;
    color: var(--text-muted);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-buttons {
    display: flex;
    gap: 0.2rem;
    margin-left: auto;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 150ms;
  }

  .card-header:hover .header-buttons {
    opacity: 1;
  }

  .btn-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 150ms, background 150ms;
  }

  .btn-icon:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
  }

  .btn-danger:hover {
    color: var(--danger, #ef4444);
  }

  /* Body */
  .card-body {
    border-top: 1px solid var(--border);
    padding: 0.75rem;
  }

  /* ---- Main layout: sidebar + grid, mirroring the home page ---- */
  .content-layout {
    display: flex;
    gap: 1.25rem;
    align-items: flex-start;
  }

  .sidebar {
    width: 260px;
    flex-shrink: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
  }

  .ref-area {
    flex: 1;
    min-width: 0;
  }

  /* ---- Todo list (sidebar) — matches main TodoList ---- */
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
    gap: 0.25rem;
  }

  .completed-list {
    margin-top: 0.25rem;
  }

  .todo-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.4rem 0.3rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.1s;
  }

  .todo-item:hover {
    background: rgba(255, 255, 255, 0.04);
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
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    accent-color: var(--accent);
    cursor: pointer;
    margin-top: 2px;
  }

  .type-badge {
    font-size: 0.6rem;
    color: var(--accent);
    background: rgba(99, 102, 241, 0.15);
    padding: 0.1rem 0.35rem;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .btn-action-icon {
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.2rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
    cursor: pointer;
  }

  .todo-item:hover .btn-action-icon {
    opacity: 1;
  }

  .btn-action-icon:hover {
    color: var(--accent);
  }

  .btn-action-danger:hover {
    color: var(--danger, #ef4444);
  }

  .btn-show-completed {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 0.4rem 0.3rem;
    margin-top: 0.5rem;
    cursor: pointer;
    transition: color 0.15s;
    border-radius: var(--radius-sm);
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

  /* ---- Reference grid (masonry) — matches main InboxGrid ---- */
  .grid {
    column-count: 2;
    column-gap: 0.75rem;
  }

  .grid-card-wrapper {
    break-inside: avoid;
    margin-bottom: 0.75rem;
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

  .btn-card-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
    transition: color 150ms, background 150ms;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  }

  .btn-card-action:hover {
    color: var(--accent);
    background: var(--bg);
  }

  .btn-card-danger:hover {
    color: var(--danger, #ef4444);
  }

  /* ---- Responsive ---- */
  @media (max-width: 800px) {
    .content-layout {
      flex-direction: column;
    }

    .sidebar {
      width: 100%;
    }

    .grid {
      column-count: 2;
    }
  }

  @media (max-width: 550px) {
    .grid {
      column-count: 1;
    }
  }

  /* ---- Misc ---- */
  .btn-action {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent);
    border: none;
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-action:hover {
    background: rgba(99, 102, 241, 0.25);
  }

  .empty-items {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    text-align: center;
  }

  .empty-items p {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
</style>
