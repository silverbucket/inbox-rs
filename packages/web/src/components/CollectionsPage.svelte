<script lang="ts">
  import type { InboxItem, Collection, CollectionGroup } from '@inbox-rs/rs-module';
  import { dndzone } from 'svelte-dnd-action';
  import {
    createCollection, storeCollection, deleteCollection, moveCollectionToGroup,
    visibleGroupedCollections, sortedGroups, storeGroup, deleteGroup,
    appConfig, updateConfig, reorderGroupCollections, setExpandedCollections,
    collectionItems, groups,
  } from '../lib/stores';
  import CollectionView from './CollectionView.svelte';
  import GroupSection from './GroupSection.svelte';
  import CollectionFormModal from './CollectionFormModal.svelte';
  import GroupFormModal from './GroupFormModal.svelte';
  import Fab from './Fab.svelte';

  let { onselect }: {
    onselect: (item: InboxItem) => void;
  } = $props();

  let editingCollection = $state<Collection | null>(null);
  let editingGroup = $state<CollectionGroup | null>(null);
  let collectionFormGroupId = $state<string | undefined>(undefined);
  let creatingCollection = $state(false);

  let isTouchDevice = $state(false);
  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    isTouchDevice = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isTouchDevice = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  // Collapse state persists in appConfig.expandedCollections. Collections
  // default to collapsed; expanding a row adds its id to the set.
  const expandedSet = $derived(new Set($appConfig.expandedCollections ?? []));

  function isExpanded(col: Collection): boolean {
    return expandedSet.has(col.id);
  }

  async function toggleExpand(col: Collection) {
    const next = new Set(expandedSet);
    if (isExpanded(col)) {
      next.delete(col.id);
    } else {
      next.add(col.id);
    }
    try {
      await updateConfig({ expandedCollections: [...next] });
    } catch (e) {
      console.error('Failed to persist expanded state', e);
    }
  }

  const sections = $derived($visibleGroupedCollections);

  // Collection ids currently visible on the page — used for expand/collapse all.
  const visibleIds = $derived(sections.flatMap(s => s.collections.map(c => c.id)));
  const anyExpanded = $derived(visibleIds.some(id => expandedSet.has(id)));

  async function toggleExpandAll() {
    const next = anyExpanded ? [] : visibleIds;
    try {
      await setExpandedCollections(next);
    } catch (e) {
      console.error('Failed to toggle expand all', e);
    }
  }

  // Per-group DnD state — keyed by group id, mirrored from sections.
  let dndByGroup = $state<Record<string, Array<Collection & { id: string }>>>({});
  $effect(() => {
    const next: Record<string, Array<Collection & { id: string }>> = {};
    for (const section of sections) {
      next[section.group.id] = section.collections.map(c => ({ ...c }));
    }
    dndByGroup = next;
  });

  function makeConsider(groupId: string) {
    return (e: CustomEvent<{ items: Array<Collection & { id: string }> }>) => {
      dndByGroup = { ...dndByGroup, [groupId]: e.detail.items };
    };
  }

  function makeFinalize(groupId: string) {
    return async (e: CustomEvent<{ items: Array<Collection & { id: string }> }>) => {
      const previous = (sections.find(s => s.group.id === groupId)?.collections ?? []).map(c => ({ ...c }));
      const updated = e.detail.items;
      dndByGroup = { ...dndByGroup, [groupId]: updated };
      try {
        await reorderGroupCollections(groupId, updated.map(c => c.id));
      } catch (error) {
        console.error('Failed to reorder collections', error);
        dndByGroup = { ...dndByGroup, [groupId]: previous };
      }
    };
  }

  function openAddCollection(groupId: string | undefined) {
    // `undefined` means the user triggered creation outside any group (e.g.
    // from the page-level FAB). The modal itself chooses an explicit real
    // group before saving; collections should never be created ungrouped.
    collectionFormGroupId = groupId;
    creatingCollection = true;
  }

  async function handleCreateCollection(col: Collection) {
    try {
      // The modal enforces an explicit group choice, so `col.groupId` is
      // always a real group id here.
      await createCollection(col);
      creatingCollection = false;
      collectionFormGroupId = undefined;
    } catch (error) {
      console.error('Failed to create collection', error);
    }
  }

  async function handleEditCollection(col: Collection) {
    if (!editingCollection) return;
    const previousGroupId = editingCollection.groupId;
    try {
      if (!col.groupId || !$groups[col.groupId]) throw new Error('Collection must have a real group');
      if (col.groupId !== previousGroupId) {
        await moveCollectionToGroup(col.id, col.groupId);
      }
      await storeCollection(col);
      editingCollection = null;
    } catch (error) {
      console.error('Failed to update collection', error);
    }
  }

  async function handleDeleteCollection() {
    if (!editingCollection) return;
    const id = editingCollection.id;
    editingCollection = null;
    try {
      await deleteCollection(id);
    } catch (error) {
      console.error('Failed to delete collection', error);
    }
  }

  async function handleEditGroup(group: CollectionGroup) {
    try {
      await storeGroup(group);
      editingGroup = null;
    } catch (error) {
      console.error('Failed to update group', error);
    }
  }

  async function handleDeleteGroup() {
    if (!editingGroup) return;
    const id = editingGroup.id;
    editingGroup = null;
    try {
      await deleteGroup(id);
    } catch (error) {
      console.error('Failed to delete group', error);
    }
  }

  const editingGroupIsEmpty = $derived.by(() => {
    if (!editingGroup) return false;
    const section = sections.find(s => s.group.id === editingGroup!.id);
    return !section || section.collections.length === 0;
  });

  // Collections must be empty before they can be deleted — same rule as
  // groups. Match the store-level guard by checking live item placement, not
  // `Collection.itemIds`, which can drift after interrupted writes.
  const editingCollectionIsEmpty = $derived.by(() => {
    if (!editingCollection) return false;
    return ($collectionItems[editingCollection.id] ?? []).length === 0;
  });
</script>

<div class="collections-page">
  <!--
    Always render the page-toolbar so the Fab has a home on desktop (inline
    labelled pill). The expand-all toggle only shows when there are
    collections to toggle, but the "New collection" action is useful in
    every state — including the empty state — so the toolbar is never
    conditional. On mobile the Fab is position:fixed (out of flow) and the
    toolbar collapses to zero height when no other controls are present.
  -->
  <div class="page-toolbar">
    {#if visibleIds.length > 0}
      <button class="btn-expand-toggle" onclick={toggleExpandAll}>
        <svg class="chevron" class:open={anyExpanded} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        {anyExpanded ? 'Collapse all' : 'Expand all'}
      </button>
    {/if}
    <Fab onclick={() => openAddCollection(undefined)} label="New collection" />
  </div>

  {#each sections as section (section.group.id)}
    {@const realCount = dndByGroup[section.group.id]?.length ?? 0}
    <GroupSection
      group={section.group}
      onedit={() => editingGroup = section.group}
      onaddcollection={() => openAddCollection(section.group.id)}
    >
      {#if realCount > 0}
        <div
          class="collection-list"
          use:dndzone={{
            items: dndByGroup[section.group.id],
            flipDurationMs: 200,
            dropTargetStyle: {},
            dragDisabled: isTouchDevice,
            type: `cols-${section.group.id}`,
          }}
          onconsider={makeConsider(section.group.id)}
          onfinalize={makeFinalize(section.group.id)}
        >
          {#each dndByGroup[section.group.id] as col (col.id)}
            <CollectionView
              collection={col}
              expanded={isExpanded(col)}
              {onselect}
              {isTouchDevice}
              onedit={() => editingCollection = col}
              ontoggle={() => toggleExpand(col)}
            />
          {/each}
        </div>
      {:else}
        <p class="group-empty">
          No collections in this group yet.
          <button class="link" onclick={() => openAddCollection(section.group.id)}>Add one</button>.
        </p>
      {/if}
    </GroupSection>
  {/each}

  {#if $sortedGroups.length === 0 && sections.length === 0}
    <p class="page-empty">
      No groups yet. Create one from the filter bar above to organise your collections.
    </p>
  {:else if sections.length === 0}
    <p class="page-empty">
      All groups are filtered out. Toggle one on in the filter bar to see collections.
    </p>
  {/if}
</div>

{#if creatingCollection}
  <CollectionFormModal
    groupId={collectionFormGroupId}
    onclose={() => { creatingCollection = false; collectionFormGroupId = undefined; }}
    onsave={handleCreateCollection}
  />
{/if}

{#if editingCollection}
  <CollectionFormModal
    collection={editingCollection}
    onclose={() => editingCollection = null}
    onsave={handleEditCollection}
    ondelete={editingCollectionIsEmpty ? handleDeleteCollection : undefined}
  />
{/if}

{#if editingGroup}
  <GroupFormModal
    group={editingGroup}
    onclose={() => editingGroup = null}
    onsave={handleEditGroup}
    ondelete={editingGroupIsEmpty ? handleDeleteGroup : undefined}
  />
{/if}

<style>
  .collections-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .page-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: -0.5rem;
  }

  /* Anchor the Fab (inline on desktop) to the right edge of the toolbar, so
     the expand-all toggle reads left-aligned and the primary action sits
     where the eye finishes scanning the row. On mobile the Fab is
     position:fixed and out of flow — this margin is a no-op. */
  .page-toolbar :global(.fab) {
    margin-left: auto;
  }

  .btn-expand-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.35rem 0.7rem;
    color: var(--text-muted);
    font-size: 0.78rem;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .btn-expand-toggle:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }

  .btn-expand-toggle .chevron {
    transition: transform 0.2s;
    transform: rotate(-90deg);
  }

  .btn-expand-toggle .chevron.open {
    transform: rotate(0);
  }

  .collection-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .group-empty {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0.25rem 0 0.5rem;
  }

  .page-empty {
    font-size: 0.9rem;
    color: var(--text-muted);
    text-align: center;
    margin-top: 1rem;
  }

  .link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    font: inherit;
    text-decoration: underline;
  }

  .link:hover {
    color: var(--accent-strong, var(--accent));
  }

  /* Mobile-only: reserve room so the fixed-position FAB doesn't float over
     the last group section when scrolled to the bottom. Desktop renders the
     add button inline in the toolbar, so no bottom reservation is needed. */
  @media (max-width: 768px) {
    .collections-page {
      padding-bottom: 5rem;
    }
  }

  @media (max-width: 600px) {
    .collections-page {
      /* Tighter bottom padding on mobile — the FAB sits closer to the edge
         and the list should feel dense. */
      padding-bottom: 4.5rem;
    }
  }
</style>
