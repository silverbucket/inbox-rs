<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { todoItems, storeItem } from '../lib/stores';
  import { cleanForStorage } from '../lib/clean-for-storage';
  import { typeBadge } from '../lib/item-utils';

  let { onselect, onadd, onexpandchange, inline = false }: {
    onselect: (item: InboxItem) => void;
    onadd: () => void;
    onexpandchange?: (expanded: boolean) => void;
    inline?: boolean;
  } = $props();
  const todos = $derived($todoItems);
  const openTodos = $derived(todos.filter(t => !t.completed));
  const completedTodos = $derived(todos.filter(t => t.completed));
  let expanded = $state(!inline);
  let showCompleted = $state(false);
  async function toggleCompleted(e: Event, todo: InboxItem) {
    e.stopPropagation();
    const updated = {
      ...todo,
      completed: !todo.completed,
      completedAt: !todo.completed ? new Date().toISOString() : undefined
    };
    await storeItem(cleanForStorage(updated));
  }

  function todoNote(item: InboxItem): string | null {
    const notes = ('notes' in item ? (item as any).notes : null) || item.description || ('body' in item ? (item as any).body : null);
    if (!notes) return null;
    const firstLine = notes.split('\n')[0].trim();
    return firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;
  }
</script>

<div class="todo-list" class:inline>
  <div class="todo-header">
    <button class="btn-toggle" onclick={() => { expanded = !expanded; onexpandchange?.(expanded); }} title={expanded ? 'Collapse' : 'Expand'}>
      <svg class="chevron" class:collapsed={!expanded} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
      <h2 class="todo-heading">Todos</h2>
      {#if openTodos.length > 0}
        <span class="todo-badge">{openTodos.length}</span>
      {:else if expanded && todos.length > 0}
        <span class="todo-count">0/{todos.length}</span>
      {/if}
    </button>
    <button class="btn-add-todo" onclick={onadd} title="Add Todo">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </button>
  </div>
  {#if expanded}
    {#if openTodos.length > 0}
      <ul role="list">
        {#each openTodos as todo (todo.id)}
          {@const badge = typeBadge(todo)}
          {@const note = todoNote(todo)}
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
              <div class="todo-title-row">
                <span class="todo-title">{todo.title}</span>
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
    {:else if todos.length === 0}
      <p class="empty">No todos yet.</p>
    {/if}

    {#if completedTodos.length > 0}
      <button class="btn-show-completed" onclick={() => showCompleted = !showCompleted}>
        <svg class="chevron-sm" class:collapsed={!showCompleted} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        {completedTodos.length} completed
      </button>
      {#if showCompleted}
        <ul role="list" class="completed-list">
          {#each completedTodos as todo (todo.id)}
            {@const badge = typeBadge(todo)}
            {@const note = todoNote(todo)}
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
                <div class="todo-title-row">
                  <span class="todo-title">{todo.title}</span>
                  <button class="btn-delete" onclick={(e) => { e.stopPropagation(); deleteTarget = todo; }} title="Delete">
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
  {/if}

</div>

<style>
  .todo-list {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
    min-width: 0;
    position: relative;
  }

  .todo-list.inline {
    background: none;
    border: none;
    border-radius: 0;
    padding: 0;
  }

  .todo-list.inline .todo-header {
    gap: 0.25rem;
  }

  .todo-list.inline .btn-toggle {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.7rem;
    font-size: 0.8rem;
    transition: border-color 0.15s, color 0.15s;
  }

  .todo-list.inline .btn-toggle:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .todo-list.inline .btn-add-todo {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.4rem;
    transition: border-color 0.15s, color 0.15s;
  }

  .todo-list.inline .btn-add-todo:hover {
    border-color: var(--accent);
  }

  .todo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .btn-toggle {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
  }

  .chevron {
    color: var(--text-muted);
    transition: transform 0.15s;
    flex-shrink: 0;
  }

  .chevron.collapsed {
    transform: rotate(-90deg);
  }

  .todo-heading {
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .todo-count {
    font-size: 0.7rem;
    color: var(--text-muted);
    opacity: 0.7;
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

  .btn-add-todo {
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.2rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    cursor: pointer;
    transition: color 0.15s;
  }

  .btn-add-todo:hover {
    color: var(--accent);
  }

  .empty {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0.75rem 0 0;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 2rem 0 0;
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

  .todo-content {
    flex: 1;
    min-width: 0;
  }

  .todo-title-row {
    display: flex;
    align-items: flex-start;
    gap: 0.25rem;
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

  .todo-item:hover {
    background: var(--bg);
  }

  .checkbox {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    accent-color: var(--accent);
    cursor: pointer;
    margin-top: 2px;
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
</style>
