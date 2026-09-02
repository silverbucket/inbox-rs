<script lang="ts">
  import type { InboxItem, Collection } from '@inbox-rs/rs-module';
  import { fade, scale } from 'svelte/transition';
  import {
    collections, groups, collectionItems,
    storeCollection, deleteCollection, moveCollectionToGroup,
    setCollectionArchived,
  } from '../lib/stores';
  import CollectionView from './CollectionView.svelte';
  import CollectionFormModal from './CollectionFormModal.svelte';

  let { collectionId, onselect, onexit }: {
    collectionId: string;
    onselect: (item: InboxItem) => void;
    /** Leave focus mode (back to wherever the user was). */
    onexit: () => void;
  } = $props();

  // Live lookups so a rename/recolor from another device shows up, and a
  // deletion collapses to the missing-collection state instead of a crash.
  const collection = $derived($collections[collectionId]);
  const group = $derived(
    collection?.groupId ? ($groups[collection.groupId] ?? null) : null,
  );

  let editing = $state(false);
  let panelEl = $state<HTMLElement>();

  let isTouchDevice = $state(false);
  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    isTouchDevice = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isTouchDevice = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  async function handleEditCollection(col: Collection) {
    const previousGroupId = collection?.groupId;
    try {
      if (!col.groupId || !$groups[col.groupId]) throw new Error('Collection must have a real group');
      if (col.groupId !== previousGroupId) {
        await moveCollectionToGroup(col.id, col.groupId);
      }
      await storeCollection(col);
      editing = false;
    } catch (error) {
      console.error('Failed to update collection', error);
    }
  }

  async function handleDeleteCollection() {
    editing = false;
    try {
      // `deleteCollection` refuses (returns false) when items still reference
      // the collection — possible despite the empty check below if another
      // device filed something in the meantime. Stay in the overlay so the
      // user sees the collection that still exists.
      if (await deleteCollection(collectionId)) onexit();
    } catch (error) {
      console.error('Failed to delete collection', error);
    }
  }

  async function handleArchiveCollection() {
    editing = false;
    try {
      await setCollectionArchived(collectionId, true);
      onexit();
    } catch (error) {
      console.error('Failed to archive collection', error);
    }
  }

  // Same emptiness rule as the store-level delete guard: live item placement,
  // not `Collection.itemIds`, which can drift after interrupted writes.
  const collectionIsEmpty = $derived(
    ($collectionItems[collectionId] ?? []).length === 0,
  );

  /**
   * Escape leaves focus mode — but only when it isn't already spoken for.
   * `<svelte:window>` listeners fire in registration order and this popup
   * mounts before any overlay it can summon, so the overlay is already in
   * the DOM when this runs: any aria-modal element *other than this panel*
   * (the app-wide modal convention) means Escape belongs to that layer.
   * Form fields keep their Escape too (capture bars and quick-adds use it
   * to clear/dismiss).
   */
  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (editing) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    for (const el of document.querySelectorAll('[aria-modal="true"]')) {
      if (el !== panelEl) return;
    }
    onexit();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<!-- The dimmed page underneath is where the user still "is" — clicking it,
     like Escape or Back, returns there. Transitions are |global because the
     whole component is added/removed by the route branch in App. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="focus-overlay"
  transition:fade|global={{ duration: isTouchDevice ? 0 : 160 }}
  onclick={onexit}
>
  <div
    class="focus-panel"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={collection ? collection.name : 'Collection'}
    bind:this={panelEl}
    transition:scale|global={{ duration: isTouchDevice ? 0 : 200, start: 0.96 }}
    onclick={(e) => e.stopPropagation()}
  >
    {#if collection}
      <div class="focus-toolbar">
        <button type="button" class="btn-back" onclick={onexit} title="Back (Esc)">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Back
        </button>
        {#if group}
          <span class="crumb-group">
            <span class="crumb-dot" style="background: {group.color || 'var(--accent)'}"></span>
            {group.name}
          </span>
        {/if}
      </div>
      <!-- The card is pinned open; collapsing it (header click / ontoggle) is
           how you leave, mirroring what collapse means on the Collections
           page. Expansion is forced by prop, never written to the synced
           `expandedCollections` set, so focusing here doesn't churn the
           accordion state on other devices. -->
      <CollectionView
        {collection}
        expanded
        {onselect}
        {isTouchDevice}
        onedit={() => editing = true}
        ontoggle={onexit}
      />
    {:else}
      <div class="focus-missing">
        <p>This collection doesn't exist — it may have been deleted.</p>
        <button type="button" class="btn-back" onclick={onexit}>Back to collections</button>
      </div>
    {/if}
  </div>
</div>

{#if editing && collection}
  <CollectionFormModal
    {collection}
    onclose={() => editing = false}
    onsave={handleEditCollection}
    ondelete={collectionIsEmpty ? handleDeleteCollection : undefined}
    onarchive={handleArchiveCollection}
  />
{/if}

<style>
  /* Above the shell header (z 100), below every modal the popup can summon
     (AddEntry/ViewCard/forms at 200, settings at 300). */
  .focus-overlay {
    position: fixed;
    inset: 0;
    z-index: 140;
    background: var(--overlay);
    /* The rim of page peeking out says "you haven't left", but it shouldn't
       compete for attention — blur it into context, not content. */
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    padding: 1.25rem;
  }

  .focus-panel {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 24px 70px -12px var(--shadow);
    padding: 0.85rem 1rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  /* Stays reachable while the collection body scrolls under it. */
  .focus-toolbar {
    position: sticky;
    top: -0.85rem;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: -0.85rem -1rem 0;
    padding: 0.7rem 1rem;
    background: color-mix(in srgb, var(--bg) 94%, transparent);
    backdrop-filter: blur(10px);
  }

  .btn-back {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.35rem 0.7rem;
    color: var(--text-muted);
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .btn-back:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }

  .crumb-group {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-muted);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .crumb-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .focus-missing {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    color: var(--text-muted);
    font-size: 0.9rem;
    text-align: center;
  }

  /* Full-bleed sheet on small screens — the popup framing costs too much
     width there, and the backdrop rim serves no purpose. */
  @media (max-width: 768px) {
    .focus-overlay {
      padding: 0;
    }

    .focus-panel {
      border: none;
      border-radius: 0;
    }
  }
</style>
