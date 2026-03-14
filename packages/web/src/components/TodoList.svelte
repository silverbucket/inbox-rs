<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { todoItems, storeItem, deleteItem } from '../lib/stores';
  import DeleteConfirm from './DeleteConfirm.svelte';

  let { onedit }: { onedit: (item: InboxItem) => void } = $props();
  const todos = $derived($todoItems);
  let deleteTarget = $state<InboxItem | null>(null);
  let deleting = $state(false);

  async function toggleCompleted(e: Event, todo: InboxItem) {
    e.stopPropagation();
    const updated = {
      ...todo,
      completed: !todo.completed,
      completedAt: !todo.completed ? new Date().toISOString() : undefined
    };
    const clean = JSON.parse(JSON.stringify(updated));
    await storeItem(clean);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    deleting = true;
    await deleteItem(deleteTarget.id, deleteTarget);
    deleteTarget = null;
    deleting = false;
  }

  function typeBadge(item: InboxItem): string | null {
    return item.type === 'todo' ? null : item.type;
  }
</script>

<div class="todo-list">
  <h2 class="todo-heading">Todos</h2>
  {#if todos.length === 0}
    <p class="empty">No todos yet.</p>
  {:else}
    <ul role="list">
      {#each todos as todo (todo.id)}
        <li class="todo-item" class:completed={todo.completed} role="button" tabindex="0"
          onclick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('input, button')) return;
            onedit(todo);
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onedit(todo); }
          }}>
          <input
            type="checkbox"
            class="checkbox"
            checked={todo.completed}
            onclick={(e) => e.stopPropagation()}
            onchange={(e) => toggleCompleted(e, todo)}
            aria-label="Mark {todo.title} as {todo.completed ? 'incomplete' : 'complete'}"
          />
          <span class="todo-title">{todo.title}</span>
          {#if typeBadge(todo)}
            <span class="type-badge">{typeBadge(todo)}</span>
          {/if}
          <button class="btn-delete" onclick={(e) => { e.stopPropagation(); deleteTarget = todo; }} title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if deleteTarget}
  <DeleteConfirm
    onConfirm={handleDelete}
    onCancel={() => deleteTarget = null}
    {deleting}
  />
{/if}

<style>
  .todo-list {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    min-width: 0;
  }

  .todo-heading {
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }

  .empty {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .todo-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.1s;
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
  }

  .todo-title {
    font-size: 0.9rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .completed .todo-title {
    text-decoration: line-through;
    opacity: 0.5;
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

  .btn-delete {
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

  .todo-item:hover .btn-delete {
    opacity: 1;
  }

  .btn-delete:hover {
    color: var(--danger);
  }
</style>
