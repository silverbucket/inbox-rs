<script lang="ts">
  import type { InboxItem, Collection } from '@inbox-rs/rs-module';
  import { dndzone } from 'svelte-dnd-action';
  import {
    sortedCollections, storeCollection, deleteCollection, reorderCollections
  } from '../lib/stores';
  import CollectionView from './CollectionView.svelte';
  import CollectionFormModal from './CollectionFormModal.svelte';
  import DeleteConfirm from './DeleteConfirm.svelte';

  let { onselect, oncreate }: {
    onselect: (item: InboxItem) => void;
    oncreate: () => void;
  } = $props();

  let expandedIds = $state<Set<string>>(new Set());
  let editingCollection = $state<Collection | null>(null);
  let deletingCollection = $state<Collection | null>(null);
  let deleting = $state(false);

  // DnD: local mutable copy of sorted collections
  let dndCollections = $state<Array<Collection & { id: string }>>([]);
  $effect(() => {
    dndCollections = $sortedCollections.map(c => ({ ...c }));
  });

  function handleDndConsider(e: CustomEvent<{ items: Array<Collection & { id: string }> }>) {
    dndCollections = e.detail.items;
  }

  function handleDndFinalize(e: CustomEvent<{ items: Array<Collection & { id: string }> }>) {
    dndCollections = e.detail.items;
    void reorderCollections(dndCollections.map(c => c.id));
  }

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }

  async function handleEditSave(col: Collection) {
    await storeCollection(col);
    editingCollection = null;
  }

  async function handleDelete() {
    if (!deletingCollection) return;
    deleting = true;
    await deleteCollection(deletingCollection.id);
    expandedIds.delete(deletingCollection.id);
    expandedIds = new Set(expandedIds);
    deletingCollection = null;
    deleting = false;
  }
</script>

<div class="collections-page">
  <div class="page-header">
    <h2>Collections</h2>
    <button class="btn-new" onclick={oncreate}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      New Collection
    </button>
  </div>

  {#if dndCollections.length === 0}
    <div class="empty-state">
      <p>No collections yet. Create one to start organizing your items.</p>
      <button class="btn-new" onclick={oncreate}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        New Collection
      </button>
    </div>
  {:else}
    <div
      class="collection-list"
      use:dndzone={{ items: dndCollections, flipDurationMs: 200, dropTargetStyle: {} }}
      onconsider={handleDndConsider}
      onfinalize={handleDndFinalize}
    >
      {#each dndCollections as col (col.id)}
        <CollectionView
          collection={col}
          expanded={expandedIds.has(col.id)}
          {onselect}
          onedit={() => { editingCollection = col; }}
          ondelete={() => { deletingCollection = col; }}
          ontoggle={() => toggleExpand(col.id)}
        />
      {/each}
    </div>
  {/if}
</div>

{#if editingCollection}
  <CollectionFormModal
    collection={editingCollection}
    onclose={() => editingCollection = null}
    onsave={handleEditSave}
  />
{/if}

{#if deletingCollection}
  <DeleteConfirm
    onConfirm={handleDelete}
    onCancel={() => { deletingCollection = null; }}
    {deleting}
  />
{/if}

<style>
  .collections-page {
    max-width: 100%;
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.25rem;
  }

  h2 {
    font-size: 1.3rem;
    font-weight: 700;
  }

  .btn-new {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent);
    border: none;
    padding: 0.45rem 0.85rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-new:hover {
    background: rgba(99, 102, 241, 0.25);
  }

  .collection-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 40vh;
    text-align: center;
    gap: 0.75rem;
  }

  .empty-state p {
    color: var(--text-muted);
    font-size: 0.9rem;
    max-width: 400px;
  }
</style>
