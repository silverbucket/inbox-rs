<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { dndzone } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import { slide, fade } from 'svelte/transition';
  import {
    visibleTodos, reorderTodosGlobal, storeItem,
    collections, sortedGroups, appConfig, updateConfig,
  } from '../lib/stores';
  import { canCaptureTodo, makeUnfiledTodo } from '../lib/add-entry-modal';
  import TodoRow from './TodoRow.svelte';
  import Fab from './Fab.svelte';

  let { onselect, onaddtodo, onaddtodoincollection }: {
    onselect: (item: InboxItem) => void;
    /** Opens the add-todo modal for richer details and optional filing. */
    onaddtodo: () => void;
    /** Opens the add-todo modal with a specific collection pre-selected.
        Used by the per-row quick-add affordance. Pass `undefined` to target
        an unfiled todo. */
    onaddtodoincollection: (collectionId: string | undefined) => void;
  } = $props();

  const todos = $derived($visibleTodos);
  const openTodos = $derived(todos.filter(t => !t.completed));
  // Completed todos are sorted newest-first by completedAt for the collapsed
  // section — the global order only governs open todos.
  const completedTodos = $derived(
    todos.filter(t => t.completed)
      .slice()
      .sort((a, b) => new Date(b.completedAt ?? b.createdAt).getTime()
                     - new Date(a.completedAt ?? a.createdAt).getTime())
  );

  // Group map by collection id, so each TodoRow can show its collection's color
  // and the parent group color without re-deriving per row.
  const collectionMap = $derived($collections);
  const groupMap = $derived(() => {
    const out: Record<string, typeof $sortedGroups[number]> = {};
    for (const g of $sortedGroups) out[g.id] = g;
    return out;
  });

  const completedExpanded = $derived($appConfig.completedTodosExpanded === true);

  let isTouchDevice = $state(false);
  let quickTitle = $state('');
  let quickSaving = $state(false);
  let quickError = $state('');

  async function addQuickTodo() {
    if (!canCaptureTodo(quickTitle) || quickSaving) return;
    quickSaving = true;
    quickError = '';
    try {
      await storeItem(makeUnfiledTodo(quickTitle));
      quickTitle = '';
    } catch (error) {
      console.error('Failed to add todo', error);
      quickError = error instanceof Error ? error.message : 'Failed to add todo';
    } finally {
      quickSaving = false;
    }
  }

  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    isTouchDevice = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isTouchDevice = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  // Local mutable copy for the dnd zone. Kept in sync with the derived list
  // whenever the upstream order changes — except while the user is mid-drag,
  // where `handleDndConsider` is authoritative.
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
      // Persist just the open ids — completed todos fall back to completedAt
      // ordering on re-render, so we don't need to thread them through config.
      await reorderTodosGlobal(dndOpen.map(t => t.id));
    } catch (error) {
      console.error('Failed to reorder todos', error);
      dndOpen = previous;
    }
  }

  async function toggleCompletedSection() {
    try {
      await updateConfig({ completedTodosExpanded: !completedExpanded });
    } catch (error) {
      console.error('Failed to toggle completed todos section', error);
    }
  }

  function lookupCollection(id: string | undefined) {
    if (!id) return null;
    return collectionMap[id] ?? null;
  }

  function lookupGroup(collectionId: string | undefined) {
    const col = lookupCollection(collectionId);
    if (!col?.groupId) return null;
    return groupMap()[col.groupId] ?? null;
  }
</script>

<div class="todos-page">
  <!--
    Always render the page-toolbar so the Fab has a home on desktop (where it
    renders inline as a labelled pill next to the count). On mobile the Fab
    is `position: fixed`, so it leaves the toolbar flow entirely — an
    otherwise-empty toolbar collapses to zero height and nothing shows.
  -->
  <div class="page-toolbar">
    {#if openTodos.length > 0}
      <span class="count-label">
        {openTodos.length} open
      </span>
    {/if}
    <Fab onclick={onaddtodo} label="New todo" />
  </div>

  {#if openTodos.length === 0 && completedTodos.length === 0}
    <div class="empty-state" in:fade={{ duration: 180 }}>
      <p class="empty-title">Jot a todo</p>
      <form
        class="quick-add"
        onsubmit={(e) => {
          e.preventDefault();
          addQuickTodo();
        }}
      >
        <input
          type="text"
          bind:value={quickTitle}
          placeholder="What needs doing?"
          aria-label="Todo title"
          disabled={quickSaving}
        />
        <button type="submit" disabled={!canCaptureTodo(quickTitle) || quickSaving}>
          {quickSaving ? 'Adding...' : 'Add'}
        </button>
      </form>
      <p class="empty-hint">Capture it now. Organize it later.</p>
      {#if quickError}
        <p class="quick-error" aria-live="polite">{quickError}</p>
      {/if}
    </div>
  {:else}
    <ul
      class="todo-list" role="list"
      use:dndzone={{
        items: dndOpen,
        flipDurationMs: 200,
        dropTargetStyle: {},
        dragDisabled: isTouchDevice,
        type: 'todos-global',
      }}
      onconsider={handleDndConsider}
      onfinalize={handleDndFinalize}
    >
      {#each dndOpen as todo (todo.id)}
        <div
          animate:flip={{ duration: 200 }}
          in:fade={{ duration: 180 }}
          out:fade={{ duration: 120 }}
        >
          <TodoRow
            {todo}
            collection={lookupCollection(todo.collectionId)}
            group={lookupGroup(todo.collectionId)}
            {onselect}
            onaddincollection={onaddtodoincollection}
          />
        </div>
      {/each}
    </ul>

    {#if completedTodos.length > 0}
      <div class="completed-section">
        <button
          class="btn-completed-toggle"
          onclick={toggleCompletedSection}
          aria-expanded={completedExpanded}
        >
          <svg class="chevron" class:open={completedExpanded} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          {completedTodos.length} completed
        </button>

        {#if completedExpanded}
          <ul
            class="todo-list completed-list"
            role="list"
            transition:slide={{ duration: isTouchDevice ? 0 : 200 }}
          >
            {#each completedTodos as todo (todo.id)}
              <div in:fade={{ duration: 150 }}>
                <TodoRow
                  {todo}
                  collection={lookupCollection(todo.collectionId)}
                  group={lookupGroup(todo.collectionId)}
                  {onselect}
                  onaddincollection={onaddtodoincollection}
                />
              </div>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .todos-page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .page-toolbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  /* Anchor the Fab (inline on desktop) to the right edge of the toolbar, so
     the count label reads left-aligned and the primary action sits where
     the eye finishes scanning the row. On mobile the Fab is position:fixed
     and out of flow — this margin is a no-op. */
  .page-toolbar :global(.fab) {
    margin-left: auto;
  }

  .count-label {
    font-size: 0.78rem;
    color: var(--text-muted);
    opacity: 0.8;
  }

  .todo-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .completed-section {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--border);
  }

  .completed-list {
    margin-top: 0.4rem;
    opacity: 0.75;
  }

  .btn-completed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.8rem;
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: color 150ms, background 150ms;
  }

  .btn-completed-toggle:hover {
    color: var(--text);
    background: var(--surface-tint);
  }

  .chevron {
    color: var(--text-muted);
    transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
    transform: rotate(-90deg);
    flex-shrink: 0;
  }

  .chevron.open {
    transform: rotate(0);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    text-align: center;
    color: var(--text-muted);
  }

  .empty-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .quick-add {
    width: min(100%, 34rem);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
    align-items: center;
  }

  .quick-add input {
    min-height: 2.75rem;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    padding: 0 0.9rem;
    font: inherit;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    transition: border-color 150ms, box-shadow 150ms;
  }

  .quick-add input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .quick-add button {
    min-height: 2.75rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: white;
    padding: 0 1rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 150ms, transform 150ms, box-shadow 150ms;
  }

  .quick-add button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  .quick-add button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .quick-add button:disabled,
  .quick-add input:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .empty-hint {
    font-size: 0.85rem;
    max-width: 32rem;
    margin: 0;
  }

  .quick-error {
    margin: 0;
    color: var(--danger);
    font-size: 0.82rem;
  }

  /* Mobile-only: reserve room so the fixed-position FAB doesn't float over
     the last todo when scrolled to the bottom. Desktop renders the add
     button inline in the toolbar, so no bottom reservation is needed. */
  @media (max-width: 768px) {
    .todos-page {
      padding-bottom: 5rem;
    }
  }

  @media (max-width: 600px) {
    .todos-page {
      padding-bottom: 4.5rem;
    }

    .empty-state {
      align-items: stretch;
      text-align: left;
      padding-inline: 0;
    }

    .quick-add {
      grid-template-columns: 1fr;
    }

    .quick-add button {
      width: 100%;
    }
  }
</style>
