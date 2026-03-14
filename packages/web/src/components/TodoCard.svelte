<script lang="ts">
  import type { TodoItem } from '@inbox-rs/rs-module';
  import { storeItem } from '../lib/stores';

  let { item }: { item: TodoItem } = $props();

  async function toggleCompleted() {
    const updated: TodoItem = {
      ...item,
      completed: !item.completed,
      completedAt: !item.completed ? new Date().toISOString() : undefined
    };
    await storeItem(updated);
  }
</script>

<div class="todo">
  <label class="todo-row">
    <input
      type="checkbox"
      checked={item.completed}
      onchange={toggleCompleted}
    />
    <span class="title" class:completed={item.completed}>{item.title}</span>
  </label>
  {#if item.body}
    <p class="body">{item.body}</p>
  {/if}
</div>

<style>
  .todo-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    cursor: pointer;
  }

  input[type="checkbox"] {
    margin-top: 0.15rem;
    accent-color: var(--accent);
    flex-shrink: 0;
  }

  .title {
    font-size: 0.95rem;
    font-weight: 600;
    transition: opacity 0.15s;
  }

  .title.completed {
    text-decoration: line-through;
    opacity: 0.5;
  }

  .body {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
