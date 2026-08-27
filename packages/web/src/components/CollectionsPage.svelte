<script lang="ts">
  import type { InboxItem, Collection, CollectionGroup } from '@inbox-rs/rs-module';
  import { dndzone } from 'svelte-dnd-action';
  import {
    createCollection, storeCollection, deleteCollection, moveCollectionToGroup,
    visibleGroupedCollections, sortedGroups, storeGroup, deleteGroup,
    appConfig, updateConfig, reorderGroupCollections, setExpandedCollections,
    collectionItems, groups, orphanCollections,
    archivedCollections, archivedGroups, setCollectionArchived, setGroupArchived,
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
  let archiveExpanded = $state(false);

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
  const orphans = $derived($orphanCollections);

  // Collection ids currently visible on the page — used for expand/collapse all.
  // Includes orphans so the toggle covers every collection rendered on the page,
  // not just the ones inside real groups.
  const visibleIds = $derived([
    ...sections.flatMap(s => s.collections.map(c => c.id)),
    ...orphans.map(c => c.id),
  ]);
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

  async function handleArchiveCollection() {
    if (!editingCollection) return;
    const id = editingCollection.id;
    editingCollection = null;
    try {
      await setCollectionArchived(id, true);
    } catch (error) {
      console.error('Failed to archive collection', error);
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

  async function handleArchiveGroup() {
    if (!editingGroup) return;
    const id = editingGroup.id;
    editingGroup = null;
    try {
      await setGroupArchived(id, true);
    } catch (error) {
      console.error('Failed to archive group', error);
    }
  }

  const archiveCount = $derived($archivedCollections.length + $archivedGroups.length);

  const editingGroupIsEmpty = $derived.by(() => {
    if (!editingGroup) return false;
    const section = sections.find(s => s.group.id === editingGroup?.id);
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
      <button type="button" class="btn-expand-toggle" onclick={toggleExpandAll}>
        <svg aria-hidden="true" class="chevron" class:open={anyExpanded} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        {anyExpanded ? 'Collapse all' : 'Expand all'}
      </button>
    {/if}
    <Fab onclick={() => openAddCollection(undefined)} label="New collection" />
  </div>

  {#if archiveCount > 0}
    <section class="archive-section" aria-label="Archived collections and groups">
      <button type="button" class="archive-toggle" aria-expanded={archiveExpanded} onclick={() => archiveExpanded = !archiveExpanded}>
        <span>Archive</span>
        <span class="archive-count">{archiveCount}</span>
      </button>
      {#if archiveExpanded}
        <div class="archive-list">
          {#each $archivedGroups as group (group.id)}
            <div class="archive-row">
              <span><strong>{group.name}</strong> · group</span>
              <button type="button" onclick={() => void setGroupArchived(group.id, false)}>Restore</button>
            </div>
          {/each}
          {#each $archivedCollections as collection (collection.id)}
            <div class="archive-row">
              <span><strong>{collection.name}</strong> · collection</span>
              <button type="button" onclick={() => void setCollectionArchived(collection.id, false)}>Restore</button>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

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
          <button type="button" class="link" onclick={() => openAddCollection(section.group.id)}>Add one</button>.
        </p>
      {/if}
    </GroupSection>
  {/each}

  {#if orphans.length > 0}
    <!--
      Advisory section for collections whose groupId is unset or points at a
      deleted group. Read-only by design: no add, no group edit, no drag.
      Recovery is per-collection via the existing CollectionView affordances
      (edit modal lets the user pick a real group, move-to-group dropdown
      does the same, delete works when the collection is empty). The section
      disappears reactively as soon as the last orphan is reassigned.
    -->
    <section
      class="orphan-section"
      aria-labelledby="orphan-collections-heading"
    >
      <header class="orphan-header">
        <svg
          class="orphan-icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <div class="orphan-text">
          <h2 id="orphan-collections-heading" class="orphan-title">
            Needs a group
            <span class="orphan-count" aria-label="{orphans.length} {orphans.length === 1 ? 'collection' : 'collections'}">{orphans.length}</span>
          </h2>
          <p class="orphan-subtitle">
            {orphans.length === 1 ? 'This collection isn\'t' : 'These collections aren\'t'} in any group.
            Edit {orphans.length === 1 ? 'it' : 'one'} to assign a group, or delete {orphans.length === 1 ? 'it' : 'them'} if no longer needed.
          </p>
        </div>
      </header>
      <div class="collection-list orphan-list">
        {#each orphans as col (col.id)}
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
    </section>
  {/if}

  {#if $sortedGroups.length === 0 && sections.length === 0 && orphans.length === 0}
    <p class="page-empty">
      No groups yet. Create one from the filter bar above to organise your collections.
    </p>
  {:else if sections.length === 0 && orphans.length === 0}
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
    onarchive={handleArchiveCollection}
  />
{/if}

{#if editingGroup}
  <GroupFormModal
    group={editingGroup}
    onclose={() => editingGroup = null}
    onsave={handleEditGroup}
    ondelete={editingGroupIsEmpty ? handleDeleteGroup : undefined}
    onarchive={handleArchiveGroup}
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

  .archive-section {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .archive-toggle, .archive-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .archive-toggle {
    border: none;
    background: var(--surface-tint);
    color: var(--text-muted);
    padding: 0.65rem 0.85rem;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .archive-count {
    font-variant-numeric: tabular-nums;
  }

  .archive-list {
    display: flex;
    flex-direction: column;
  }

  .archive-row {
    padding: 0.6rem 0.85rem;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.82rem;
  }

  .archive-row button {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    padding: 0.3rem 0.6rem;
    cursor: pointer;
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

  /* Advisory section for orphan collections. Visually distinct from real
     GroupSections — dashed top border, muted tint, no group color stripe,
     no group-level controls — so users read it as a recovery surface, not
     "another bucket" they can put things into. */
  .orphan-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.5rem;
    padding-top: 0.85rem;
    border-top: 1px dashed var(--border);
  }

  .orphan-header {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.65rem 0.85rem;
    background: var(--surface-tint);
    border-radius: var(--radius-sm);
  }

  .orphan-icon {
    flex-shrink: 0;
    color: var(--text-muted);
    margin-top: 0.1rem;
  }

  .orphan-text {
    flex: 1;
    min-width: 0;
  }

  /* Match other section headings in size/weight but stay neutral — this
     isn't an error, just a hint, so we deliberately avoid --danger here. */
  .orphan-title {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }

  .orphan-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.4rem;
    height: 1.4rem;
    padding: 0 0.4rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-muted);
    background: var(--surface-tint-hover);
    border-radius: 999px;
  }

  .orphan-subtitle {
    margin: 0.2rem 0 0;
    font-size: 0.82rem;
    line-height: 1.4;
    color: var(--text-muted);
  }

  /* Static stack — no dndzone, no drag handles. The list reuses
     CollectionView so the per-card edit/move/delete affordances are the
     same as anywhere else on the page. */
  .orphan-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
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
