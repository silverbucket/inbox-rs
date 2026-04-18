<script lang="ts">
  import { dndzone } from 'svelte-dnd-action';
  import type { CollectionGroup } from '@inbox-rs/rs-module';
  import { sortedGroups, activeGroupIds, toggleGroupFilter, reorderGroups } from '../lib/stores';

  let { onaddgroup, dimmed = false }: {
    onaddgroup: () => void;
    /** Visually de-emphasise pills (e.g. when on Inbox where filters don't apply). */
    dimmed?: boolean;
  } = $props();

  const groups = $derived($sortedGroups);
  const active = $derived($activeGroupIds);

  let isTouchDevice = $state(false);
  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    isTouchDevice = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isTouchDevice = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  let dndGroups = $state<Array<CollectionGroup & { id: string }>>([]);
  $effect(() => {
    dndGroups = groups.map(g => ({ ...g }));
  });

  function handleDndConsider(e: CustomEvent<{ items: Array<CollectionGroup & { id: string }> }>) {
    dndGroups = e.detail.items;
  }

  async function handleDndFinalize(e: CustomEvent<{ items: Array<CollectionGroup & { id: string }> }>) {
    const previous = groups.map(g => ({ ...g }));
    dndGroups = e.detail.items;
    try {
      await reorderGroups(dndGroups.map(g => g.id));
    } catch (error) {
      console.error('Failed to reorder groups', error);
      dndGroups = previous;
    }
  }

  async function handleToggle(e: Event, groupId: string) {
    e.preventDefault();
    await toggleGroupFilter(groupId);
  }
</script>

<div class="filter-bar" class:dimmed role="toolbar" aria-label="Group filters">
  {#if dndGroups.length === 0}
    <button class="empty-cta" onclick={onaddgroup}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      Create your first group
    </button>
  {:else}
    <div
      class="pills"
      use:dndzone={{ items: dndGroups, flipDurationMs: 200, dropTargetStyle: {}, dragDisabled: isTouchDevice, type: 'filter-groups' }}
      onconsider={handleDndConsider}
      onfinalize={handleDndFinalize}
    >
      {#each dndGroups as group (group.id)}
        {@const isActive = active.has(group.id)}
        <button
          type="button"
          class="pill"
          class:active={isActive}
          style="--pill-color: {group.color || 'var(--accent)'}"
          aria-pressed={isActive}
          title={isActive ? `Hide ${group.name}` : `Show ${group.name}`}
          onclick={(e) => handleToggle(e, group.id)}
        >
          <span class="pill-dot"></span>
          <span class="pill-name">{group.name}</span>
        </button>
      {/each}
    </div>
    <button class="add-group" onclick={onaddgroup} title="Create new group" aria-label="Create new group">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </button>
  {/if}
</div>

<style>
  .filter-bar {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0;
    transition: opacity 180ms ease;
    min-width: 0;
  }

  .filter-bar.dimmed {
    opacity: 0.75;
  }

  /* Pills take all available space and wrap within their own box, so the
     add-group button on the right stays pinned to the first row rather than
     being pushed to a new line when pill count * width exceeds the width. */
  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    flex: 1 1 auto;
    min-width: 0;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 1.9rem;
    padding: 0 0.75rem;
    border: 1px solid color-mix(in srgb, var(--pill-color) 40%, var(--border) 60%);
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 150ms, color 150ms, border-color 150ms;
    -webkit-tap-highlight-color: transparent;
  }

  .pill:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--pill-color) 60%, var(--border) 40%);
  }

  .pill.active {
    background: color-mix(in srgb, var(--pill-color) 20%, var(--surface) 80%);
    border-color: color-mix(in srgb, var(--pill-color) 55%, var(--border) 45%);
    color: var(--text);
  }

  .pill-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--pill-color);
    flex-shrink: 0;
  }

  .pill-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 14rem;
  }

  .add-group {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 150ms, background 150ms;
    flex-shrink: 0;
    opacity: 0.6;
  }

  .add-group:hover {
    color: var(--accent);
    background: var(--accent-subtler);
    opacity: 1;
  }

  .empty-cta {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: 1px dashed var(--border);
    color: var(--text-muted);
    padding: 0.4rem 0.85rem;
    border-radius: 999px;
    font-size: 0.85rem;
    cursor: pointer;
    transition: color 150ms, border-color 150ms;
  }

  .empty-cta:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  @media (max-width: 768px) {
    .pill {
      font-size: 0.8rem;
      padding: 0 0.65rem;
      min-height: 1.75rem;
    }

    .pill-name {
      max-width: 9rem;
    }
  }
</style>
