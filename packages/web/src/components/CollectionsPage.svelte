<script lang="ts">
  import type { InboxItem, Collection, CollectionGroup } from '@inbox-rs/rs-module';
  import { get } from 'svelte/store';
  import { dndzone } from 'svelte-dnd-action';
  import {
    sortedCollections, storeCollection, deleteCollection, reorderCollections,
    groups, groupCollections, ungroupedCollections, storeGroup, deleteGroup, moveCollectionToGroup,
    appConfig, updateConfig, reorderGroupCollections
  } from '../lib/stores';
  import CollectionView from './CollectionView.svelte';
  import CollectionFormModal from './CollectionFormModal.svelte';
  import GroupFormModal from './GroupFormModal.svelte';

  let { onselect, oncreate, groupId = undefined }: {
    onselect: (item: InboxItem) => void;
    oncreate: () => void;
    groupId?: string;
  } = $props();

  let expandedIds = $state<Set<string>>(new Set($appConfig.expandedCollections ?? []));
  let editingCollection = $state<Collection | null>(null);
  let editingGroup = $state<CollectionGroup | null>(null);

  let isTouchDevice = $state(false);
  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    isTouchDevice = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isTouchDevice = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  // Sync expanded state from config when it loads/changes
  let configInitialized = false;
  $effect(() => {
    const saved = $appConfig.expandedCollections;
    if (saved && !configInitialized) {
      expandedIds = new Set(saved);
      configInitialized = true;
    }
  });

  const currentGroup = $derived(groupId ? $groups[groupId] : undefined);

  const filteredCollections = $derived.by(() => {
    if (groupId) {
      const grpCols = $groupCollections[groupId];
      return grpCols ?? [];
    }
    return $ungroupedCollections;
  });

  // DnD: local mutable copy of filtered collections
  let dndCollections = $state<Array<Collection & { id: string }>>([]);
  $effect(() => {
    dndCollections = filteredCollections.map(c => ({ ...c }));
  });

  function handleDndConsider(e: CustomEvent<{ items: Array<Collection & { id: string }> }>) {
    dndCollections = e.detail.items;
  }

  async function handleDndFinalize(e: CustomEvent<{ items: Array<Collection & { id: string }> }>) {
    const previous = filteredCollections.map(c => ({ ...c }));
    dndCollections = e.detail.items;
    const newIds = dndCollections.map(c => c.id);
    try {
      if (groupId) {
        await reorderGroupCollections(groupId, newIds);
      } else {
        // Merge reordered subset into full order, preserving grouped collections' positions
        let currentOrder: string[] = [];
        currentOrder = get(appConfig).collectionsOrder ?? [];
        const reorderedSet = new Set(newIds);
        const merged = currentOrder.filter(id => !reorderedSet.has(id));
        merged.push(...newIds);
        await reorderCollections(merged);
      }
    } catch (error) {
      console.error('Failed to reorder collections', error);
      dndCollections = previous;
    }
  }

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
    void updateConfig({ expandedCollections: [...next] }).catch(e => {
      console.error('Failed to persist expanded state', e);
    });
  }

  async function handleEditSave(col: Collection) {
    await storeCollection(col);
    editingCollection = null;
  }

  async function handleDeleteCollection() {
    if (!editingCollection) return;
    const id = editingCollection.id;
    editingCollection = null;
    await deleteCollection(id);
    expandedIds.delete(id);
    expandedIds = new Set(expandedIds);
  }

  async function handleEditGroup(group: CollectionGroup) {
    await storeGroup(group);
    editingGroup = null;
  }

  async function handleDeleteGroup() {
    if (!groupId) return;
    editingGroup = null;
    await deleteGroup(groupId);
    window.location.hash = '#/collections';
  }
</script>

<div class="collections-page">
  <div class="page-header">
    {#if currentGroup}
      <div class="group-header">
        <span class="group-dot-lg" style="background: {currentGroup.color || 'var(--accent)'}"></span>
        <h2>{currentGroup.name}</h2>
        <div class="group-actions">
          <button class="btn-icon-sm" onclick={() => editingGroup = currentGroup} title="Edit group" aria-label="Edit group">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>
      </div>
    {:else}
      <h2>Collections</h2>
    {/if}
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
      <p>{groupId ? 'No collections in this group yet.' : 'No collections yet.'} Create one to start organizing your items.</p>
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
      use:dndzone={{ items: dndCollections, flipDurationMs: 200, dropTargetStyle: {}, dragDisabled: isTouchDevice }}
      onconsider={handleDndConsider}
      onfinalize={handleDndFinalize}
    >
      {#each dndCollections as col (col.id)}
        <CollectionView
          collection={col}
          expanded={expandedIds.has(col.id)}
          {onselect}
          {isTouchDevice}
          onedit={() => { editingCollection = col; }}
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
    ondelete={handleDeleteCollection}
  />
{/if}

{#if editingGroup}
  <GroupFormModal
    group={editingGroup}
    onclose={() => editingGroup = null}
    onsave={handleEditGroup}
    ondelete={groupId ? handleDeleteGroup : undefined}
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

  .group-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .group-dot-lg {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .group-actions {
    display: flex;
    gap: 0.15rem;
    margin-left: 0.25rem;
  }

  .btn-icon-sm {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 150ms, background 150ms;
  }

  .btn-icon-sm:hover {
    color: var(--text);
    background: var(--surface-tint);
  }

  .btn-new {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--accent-subtle);
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
    background: var(--accent-subtle-strong);
  }

  .collection-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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
