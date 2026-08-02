<script lang="ts">
  import type { InboxItem, InboxItemType, Collection } from '@inbox-rs/rs-module';
  import { dndzone } from 'svelte-dnd-action';
  import { slide } from 'svelte/transition';
  import {
    collectionItems, deleteItem,
    appConfig, updateConfig, reorderCollectionItems,
  } from '../lib/stores';
  import { setItemCompleted } from '../lib/schedule-sync';
  import {
    filterCompletedTodos,
    filterOpenTodos,
    filterTodos,
    spliceOpenTodoOrder,
  } from '../lib/collection-todos';
  import { typeBadge, todoNote } from '../lib/item-utils';
  import AddEntryModal from './AddEntryModal.svelte';

  let { collection, onselect, onedit }: {
    collection: Collection;
    onselect: (item: InboxItem) => void;
    onedit: () => void;
  } = $props();

  const items = $derived($collectionItems[collection.id] ?? []);
  const todoItems = $derived(filterTodos(items));
  const openTodos = $derived(filterOpenTodos(todoItems));
  const completedTodos = $derived(filterCompletedTodos(todoItems));

  // Collapse state persists in appConfig.expandedCollections. Collections
  // default to collapsed; expanding a tile adds its id to the set.
  const expandedSet = $derived(new Set($appConfig.expandedCollections ?? []));
  const expanded = $derived(expandedSet.has(collection.id));

  let showCompleted = $state(false);
  let addingType = $state<InboxItemType | null>(null);

  let isTouchDevice = $state(false);
  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    isTouchDevice = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isTouchDevice = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

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
    try {
      const newItemIds = spliceOpenTodoOrder(
        collection.itemIds,
        previous.map(t => t.id),
        dndOpen.map(t => t.id),
      );
      await reorderCollectionItems(collection.id, newItemIds);
    } catch (error) {
      console.error('Failed to reorder collection todos', error);
      dndOpen = previous;
    }
  }

  async function toggleCompleted(e: Event, item: InboxItem) {
    e.stopPropagation();
    try {
      // Shared helper: local flip + best-effort calendar sync for scheduled
      // tasks (STATUS:COMPLETED on the posted VTODO).
      await setItemCompleted(item, !item.completed);
    } catch (error) {
      console.error('Failed to toggle todo completion', error);
      // Checkbox reverts on next render because the item prop is unchanged
    }
  }

  async function handleExpandToggle() {
    const next = new Set(expandedSet);
    if (expanded) {
      next.delete(collection.id);
    } else {
      next.add(collection.id);
    }
    try {
      await updateConfig({ expandedCollections: [...next] });
    } catch (error) {
      console.error('Failed to persist tile expand state', error);
    }
  }
</script>

<section
  class="tile"
  class:expanded
  style="--col-color: {collection.color || '#6366f1'}"
>
  <header class="tile-header">
    <button type="button" class="btn-toggle" onclick={handleExpandToggle} aria-expanded={expanded}>
      <span class="color-bar" aria-hidden="true"></span>
      <svg aria-hidden="true" class="chevron" class:open={expanded} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
      <h3 class="title">{collection.name}</h3>
      {#if openTodos.length > 0}
        <span class="badge">{openTodos.length}</span>
      {:else if todoItems.length > 0}
        <span class="count">0/{todoItems.length}</span>
      {/if}
    </button>
    <div class="actions">
      <button type="button" class="btn-action" onclick={() => addingType = 'todo'} title="Add todo to {collection.name}" aria-label="Add todo to {collection.name}">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
      <button type="button" class="btn-action" onclick={onedit} title="Edit collection" aria-label="Edit {collection.name}">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
    </div>
  </header>

  {#if expanded}
    <div class="tile-body" transition:slide={{ duration: isTouchDevice ? 0 : 200 }}>
      {#if dndOpen.length > 0}
        <ul
          class="todo-list" role="list"
          use:dndzone={{ items: dndOpen, flipDurationMs: 200, dropTargetStyle: {}, dragDisabled: isTouchDevice }}
          onconsider={handleDndConsider}
          onfinalize={handleDndFinalize}
        >
          {#each dndOpen as item (item.id)}
            {@const badge = typeBadge(item)}
            {@const note = todoNote(item)}
            <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
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
                <span class="todo-title">{item.title}</span>
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
        <p class="empty">No todos here.</p>
      {/if}

      {#if completedTodos.length > 0}
        <button type="button" class="btn-completed" onclick={() => showCompleted = !showCompleted}>
          <svg aria-hidden="true" class="chevron-sm" class:collapsed={!showCompleted} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          {completedTodos.length} completed
        </button>
        {#if showCompleted}
          <ul class="todo-list completed-list" role="list">
            {#each completedTodos as item (item.id)}
              {@const badge = typeBadge(item)}
              <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
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
                  <span class="todo-title">{item.title}</span>
                  {#if badge}
                    <div class="todo-meta"><span class="type-badge">{badge}</span></div>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  {/if}
</section>

{#if addingType}
  <AddEntryModal
    type={addingType}
    collectionId={collection.id}
    onclose={() => addingType = null}
    ondelete={async (item) => { await deleteItem(item.id, item); addingType = null; }}
  />
{/if}

<style>
  .tile {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem 0.75rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .tile-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 1.75rem;
  }

  .btn-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    flex: 1;
    min-width: 0;
  }

  .color-bar {
    width: 4px;
    align-self: stretch;
    min-height: 1.25rem;
    border-radius: 2px;
    background: var(--col-color);
    flex-shrink: 0;
  }

  .chevron {
    color: var(--text-muted);
    transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1);
    flex-shrink: 0;
    transform: rotate(-90deg);
  }

  .chevron.open {
    transform: rotate(0);
  }

  .title {
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0;
    color: var(--text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }

  .badge {
    font-size: 0.65rem;
    font-weight: 600;
    color: white;
    background: var(--col-color);
    min-width: 18px;
    height: 18px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 5px;
    line-height: 1;
    flex-shrink: 0;
  }

  .count {
    font-size: 0.7rem;
    color: var(--text-muted);
    opacity: 0.7;
    flex-shrink: 0;
  }

  .actions {
    display: flex;
    gap: 0.15rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 150ms;
  }

  .tile-header:hover .actions,
  .tile-header:focus-within .actions {
    opacity: 1;
  }

  @media (hover: none) {
    .actions {
      opacity: 1;
    }
  }

  .btn-action {
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

  .btn-action:hover {
    color: var(--text);
    background: var(--surface-tint);
  }

  .tile-body {
    margin-top: 0.6rem;
  }

  .todo-list {
    list-style: none;
    padding: 0;
    margin: 0;
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
    padding: 0.4rem 0.3rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 150ms;
    -webkit-tap-highlight-color: transparent;
  }

  .todo-item:hover {
    background: var(--bg);
  }

  .todo-content {
    flex: 1;
    min-width: 0;
  }

  .todo-title {
    font-size: 0.9rem;
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
    accent-color: var(--col-color);
    cursor: pointer;
    margin-top: 2px;
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

  .empty {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
  }

  .btn-completed {
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
    transition: color 150ms;
    border-radius: var(--radius-sm);
  }

  .btn-completed:hover {
    color: var(--text);
  }

  .chevron-sm {
    color: var(--text-muted);
    transition: transform 150ms;
    flex-shrink: 0;
  }

  .chevron-sm.collapsed {
    transform: rotate(-90deg);
  }
</style>
