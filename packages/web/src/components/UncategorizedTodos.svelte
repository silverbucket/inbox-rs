<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { dndzone } from 'svelte-dnd-action';
  import { slide } from 'svelte/transition';
  import { uncategorizedTodos, storeItem, reorderTodos, appConfig, updateConfig } from '../lib/stores';
  import { cleanForStorage } from '../lib/clean-for-storage';
  import { typeBadge, todoNote } from '../lib/item-utils';

  let { onselect, onadd }: {
    onselect: (item: InboxItem) => void;
    onadd: () => void;
  } = $props();

  const todos = $derived($uncategorizedTodos);
  const openTodos = $derived(todos.filter(t => !t.completed));
  const completedTodos = $derived(todos.filter(t => t.completed));

  // Derived (not $state) so "expand all" / "collapse all" on TodosPage — which
  // writes uncategorizedTodosCollapsed via updateConfig — stays in sync here.
  const expanded = $derived(!($appConfig.uncategorizedTodosCollapsed ?? false));
  let showCompleted = $state(false);

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
      await reorderTodos(dndOpen.map(t => t.id));
    } catch (error) {
      console.error('Failed to reorder uncategorized todos', error);
      dndOpen = previous;
    }
  }

  async function toggleCompleted(e: Event, todo: InboxItem) {
    e.stopPropagation();
    const updated = {
      ...todo,
      completed: !todo.completed,
      completedAt: !todo.completed ? new Date().toISOString() : undefined,
    };
    await storeItem(cleanForStorage(updated));
  }

  async function handleExpandToggle() {
    // `expanded` is derived from config — flip the persisted flag and let the
    // derived value update on the next store tick.
    try {
      await updateConfig({ uncategorizedTodosCollapsed: expanded });
    } catch (error) {
      console.error('Failed to persist uncategorized todos collapse state', error);
    }
  }
</script>

<section class="tile" class:expanded>
  <header class="tile-header">
    <button class="btn-toggle" onclick={handleExpandToggle} aria-expanded={expanded}>
      <svg class="chevron" class:collapsed={!expanded} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
      <h3 class="title">Uncategorized</h3>
      {#if openTodos.length > 0}
        <span class="badge">{openTodos.length}</span>
      {:else if todos.length > 0}
        <span class="count">0/{todos.length}</span>
      {/if}
    </button>
    <button class="btn-add" onclick={onadd} title="Add todo" aria-label="Add a new todo">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </button>
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
          {#each dndOpen as todo (todo.id)}
            {@const badge = typeBadge(todo)}
            {@const note = todoNote(todo)}
            <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
            <li class="todo-item" role="button" tabindex="0"
              onclick={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest('input, button')) return;
                onselect(todo);
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(todo); }
              }}>
              <input
                type="checkbox"
                class="checkbox"
                checked={false}
                onclick={(e) => e.stopPropagation()}
                onchange={(e) => toggleCompleted(e, todo)}
                aria-label="Mark {todo.title} as complete"
              />
              <div class="todo-content">
                <span class="todo-title">{todo.title}</span>
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
      {:else if todos.length === 0}
        <p class="empty">No uncategorized todos.</p>
      {/if}

      {#if completedTodos.length > 0}
        <button class="btn-completed" onclick={() => showCompleted = !showCompleted}>
          <svg class="chevron-sm" class:collapsed={!showCompleted} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          {completedTodos.length} completed
        </button>
        {#if showCompleted}
          <ul class="todo-list completed-list" role="list">
            {#each completedTodos as todo (todo.id)}
              {@const badge = typeBadge(todo)}
              <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
              <li class="todo-item completed" role="button" tabindex="0"
                onclick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest('input, button')) return;
                  onselect(todo);
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(todo); }
                }}>
                <input
                  type="checkbox"
                  class="checkbox"
                  checked={true}
                  onclick={(e) => e.stopPropagation()}
                  onchange={(e) => toggleCompleted(e, todo)}
                  aria-label="Mark {todo.title} as incomplete"
                />
                <div class="todo-content">
                  <span class="todo-title">{todo.title}</span>
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

<style>
  .tile {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
  }

  .tile-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
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

  .chevron {
    color: var(--text-muted);
    transition: transform 150ms;
    flex-shrink: 0;
  }

  .chevron.collapsed {
    transform: rotate(-90deg);
  }

  .title {
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin: 0;
  }

  .badge {
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

  .count {
    font-size: 0.7rem;
    color: var(--text-muted);
    opacity: 0.7;
  }

  .btn-add {
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.25rem;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    transition: color 150ms;
    flex-shrink: 0;
  }

  .btn-add:hover {
    color: var(--accent);
  }

  .tile-body {
    margin-top: 0.75rem;
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
    accent-color: var(--accent);
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
