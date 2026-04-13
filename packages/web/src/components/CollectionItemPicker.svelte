<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { sortedItems, todoItems } from '../lib/stores';

  let { onclose, onpick }: {
    onclose: () => void;
    onpick: (item: InboxItem) => void;
  } = $props();

  let search = $state('');

  const availableItems = $derived.by(() => {
    const all = [...$sortedItems, ...$todoItems];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(i =>
      i.title.toLowerCase().includes(q) ||
      i.description?.toLowerCase().includes(q) ||
      ('body' in i && typeof (i as any).body === 'string' && (i as any).body.toLowerCase().includes(q))
    );
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose}>
  <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <h2>Add Items to Collection</h2>

    <input
      type="text"
      class="search"
      bind:value={search}
      placeholder="Search inbox items..."
    />

    <div class="item-list">
      {#if availableItems.length === 0}
        <div class="empty">
          {search ? 'No matching items' : 'No items in inbox'}
        </div>
      {:else}
        {#each availableItems as item (item.id)}
          <button class="item-row" onclick={() => onpick(item)}>
            <span class="type-badge">{item.type}</span>
            <span class="item-title">{item.title}</span>
            <svg class="add-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        {/each}
      {/if}
    </div>

    <div class="actions">
      <button class="btn-cancel" onclick={onclose}>Done</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    overscroll-behavior: contain;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    max-width: 480px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
  }

  h2 {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
  }

  .search {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    padding: 0.5rem 0.65rem;
    font-size: 0.9rem;
    font-family: inherit;
    margin-bottom: 0.75rem;
  }

  .search:focus {
    outline: none;
    border-color: var(--accent);
  }

  .item-list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.5rem;
    border: none;
    background: none;
    color: var(--text);
    font-size: 0.85rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background 120ms;
    text-align: left;
  }

  .item-row:hover {
    background: var(--accent-subtler);
  }

  .type-badge {
    background: var(--accent-subtle);
    color: var(--accent);
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .item-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .add-icon {
    flex-shrink: 0;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 150ms;
  }

  .item-row:hover .add-icon {
    opacity: 1;
  }

  .empty {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  .btn-cancel {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .btn-cancel:hover {
    border-color: var(--text-muted);
  }
</style>
