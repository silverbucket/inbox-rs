<script lang="ts">
  import type { InboxItem, Collection, CollectionGroup } from '@inbox-rs/rs-module';
  import {
    visibleGroupedCollections, sortedGroups, storeGroup, deleteGroup,
    storeCollection, deleteCollection, moveCollectionToGroup,
    appConfig, updateConfig,
  } from '../lib/stores';
  import UncategorizedTodos from './UncategorizedTodos.svelte';
  import GroupSection from './GroupSection.svelte';
  import CollectionTodoTile from './CollectionTodoTile.svelte';
  import CollectionFormModal from './CollectionFormModal.svelte';
  import GroupFormModal from './GroupFormModal.svelte';

  let { onselect, onaddtodo }: {
    onselect: (item: InboxItem) => void;
    /** Open the add-todo flow targeted at the uncategorized list. */
    onaddtodo: () => void;
  } = $props();

  let editingCollection = $state<Collection | null>(null);
  let editingGroup = $state<CollectionGroup | null>(null);
  let collectionFormGroupId = $state<string | undefined>(undefined);
  let creatingCollection = $state(false);

  const sections = $derived($visibleGroupedCollections);

  // Collection ids currently visible on the page — used for expand/collapse all.
  // Uncategorized todos has its own collapse flag; we treat it as "expanded"
  // when uncategorizedTodosCollapsed is false (the default).
  const expandedSet = $derived(new Set($appConfig.expandedCollections ?? []));
  const visibleIds = $derived(sections.flatMap(s => s.collections.map(c => c.id)));
  const uncatExpanded = $derived(!($appConfig.uncategorizedTodosCollapsed ?? false));
  const anyExpanded = $derived(uncatExpanded || visibleIds.some(id => expandedSet.has(id)));

  async function toggleExpandAll() {
    const expand = !anyExpanded;
    try {
      await updateConfig({
        expandedCollections: expand ? visibleIds : [],
        uncategorizedTodosCollapsed: !expand,
      });
    } catch (e) {
      console.error('Failed to toggle expand all', e);
    }
  }

  function openAddCollection(groupId: string) {
    collectionFormGroupId = groupId;
    creatingCollection = true;
  }

  async function handleCreateCollection(col: Collection) {
    try {
      await storeCollection(col);
      if (col.groupId) {
        await moveCollectionToGroup(col.id, col.groupId);
      }
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
      await storeCollection(col);
      if (col.groupId && col.groupId !== previousGroupId) {
        await moveCollectionToGroup(col.id, col.groupId);
      }
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

  // True when a group has zero collections — required to allow deletion.
  const editingGroupIsEmpty = $derived.by(() => {
    if (!editingGroup) return false;
    const section = sections.find(s => s.group.id === editingGroup!.id);
    return !section || section.collections.length === 0;
  });
</script>

<div class="todos-page">
  {#if visibleIds.length > 0}
    <div class="page-toolbar">
      <button class="btn-expand-toggle" onclick={toggleExpandAll}>
        <svg class="chevron" class:open={anyExpanded} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        {anyExpanded ? 'Collapse all' : 'Expand all'}
      </button>
    </div>
  {/if}

  <UncategorizedTodos {onselect} onadd={onaddtodo} />

  {#each sections as section (section.group.id)}
    <GroupSection
      group={section.group}
      onedit={() => editingGroup = section.group}
      onaddcollection={() => openAddCollection(section.group.id)}
    >
      {#if section.collections.length === 0}
        <p class="group-empty">
          No collections in this group yet.
          <button class="link" onclick={() => openAddCollection(section.group.id)}>Add one</button>.
        </p>
      {:else}
        <div class="tile-grid">
          {#each section.collections as col (col.id)}
            <CollectionTodoTile
              collection={col}
              {onselect}
              onedit={() => editingCollection = col}
            />
          {/each}
        </div>
      {/if}
    </GroupSection>
  {/each}

  {#if $sortedGroups.length === 0}
    <p class="page-empty">
      No groups yet. Create one from the filter bar above to organise your collections.
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
    ondelete={handleDeleteCollection}
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
  .todos-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .page-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-bottom: -0.5rem;
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

  .tile-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.75rem;
    align-items: start;
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
</style>
