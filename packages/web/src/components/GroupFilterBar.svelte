<script lang="ts">
  import { dndzone } from 'svelte-dnd-action';
  import {
    sortedGroups, activeGroupIds, toggleGroupFilter, reorderGroups,
    uncategorizedFilterActive, toggleUncategorizedFilter,
    UNCATEGORIZED_FILTER_ID, appConfig, hasUncategorizedItems,
    ungroupedCollections,
  } from '../lib/stores';

  let { onaddgroup, dimmed = false }: {
    onaddgroup: () => void;
    /** Visually de-emphasise pills (e.g. when on Inbox where filters don't apply). */
    dimmed?: boolean;
  } = $props();

  /**
   * Row shape used by the dnd zone. Both real groups and the virtual
   * Uncategorized entry share this so drag-reorder, key-based animation,
   * and the render template all work without any special casing.
   */
  type FilterPill = {
    id: string;
    name: string;
    color: string;
    isUncat: boolean;
  };

  const groups = $derived($sortedGroups);
  const active = $derived($activeGroupIds);
  const uncatActive = $derived($uncategorizedFilterActive);
  const groupsOrder = $derived($appConfig.groupsOrder ?? []);
  // Uncategorized is a dynamic pill — it appears only when the system has
  // something to show there. "Something" means either straggler items (todos
  // without a collection, or orphaned refs) OR ungrouped collections the user
  // might want to filter. Without either, the pill would be a confusing
  // no-op, so we hide it entirely.
  const showUncat = $derived($hasUncategorizedItems || $ungroupedCollections.length > 0);

  let isTouchDevice = $state(false);
  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    isTouchDevice = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isTouchDevice = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  // Uncategorized is folded into the pill list as a peer of real groups.
  // Its position is recorded by writing the sentinel id into `groupsOrder`;
  // `sortedGroups` filters unknown ids out naturally, so no other consumer
  // needs to know about the sentinel.
  const uncatPill: FilterPill = {
    id: UNCATEGORIZED_FILTER_ID,
    name: 'Uncategorized',
    color: 'var(--accent)',
    isUncat: true,
  };

  const pills = $derived.by<FilterPill[]>(() => {
    const realPills: FilterPill[] = groups.map(g => ({
      id: g.id,
      name: g.name,
      color: g.color || 'var(--accent)',
      isUncat: false,
    }));
    const sentinelIdx = groupsOrder.indexOf(UNCATEGORIZED_FILTER_ID);
    // If the user has never reordered the pills, default to Uncategorized
    // at the end — same visual cadence as a newly-created group. Skip the
    // sentinel when it has nothing to show (no stragglers, no ungrouped
    // collections).
    if (sentinelIdx < 0) return showUncat ? [...realPills, uncatPill] : realPills;

    // Walk the persisted order and rebuild the list so the sentinel's slot
    // is preserved relative to the real groups. Any real groups not yet in
    // `groupsOrder` (e.g. just-created) are appended afterwards.
    const byId = new Map(realPills.map(p => [p.id, p]));
    const placed: FilterPill[] = [];
    const seen = new Set<string>();
    for (const id of groupsOrder) {
      if (id === UNCATEGORIZED_FILTER_ID) {
        if (showUncat) placed.push(uncatPill);
        seen.add(id);
      } else if (byId.has(id)) {
        placed.push(byId.get(id)!);
        seen.add(id);
      }
    }
    for (const p of realPills) {
      if (!seen.has(p.id)) placed.push(p);
    }
    return placed;
  });

  let dndPills = $state<FilterPill[]>([]);
  $effect(() => { dndPills = pills.map(p => ({ ...p })); });

  function handleDndConsider(e: CustomEvent<{ items: FilterPill[] }>) {
    dndPills = e.detail.items;
  }

  async function handleDndFinalize(e: CustomEvent<{ items: FilterPill[] }>) {
    const previous = pills.map(p => ({ ...p }));
    dndPills = e.detail.items;
    try {
      // Persist every id — including the sentinel — so Uncategorized keeps
      // its slot across reloads alongside the real group order.
      await reorderGroups(dndPills.map(p => p.id));
    } catch (error) {
      console.error('Failed to reorder filter pills', error);
      dndPills = previous;
    }
  }

  async function handleToggle(e: Event, pill: FilterPill) {
    e.preventDefault();
    try {
      if (pill.isUncat) await toggleUncategorizedFilter();
      else await toggleGroupFilter(pill.id);
    } catch (error) {
      console.error('Failed to toggle filter pill', error);
    }
  }

  function isPillActive(pill: FilterPill): boolean {
    return pill.isUncat ? uncatActive : active.has(pill.id);
  }
</script>

<div class="filter-bar" class:dimmed role="toolbar" aria-label="Filters">
  <!-- Single dnd zone: real groups and Uncategorized are the same shape and
       participate in the same drag-sort flow. No divider, no special slot. -->
  <div
    class="pills"
    use:dndzone={{
      items: dndPills,
      flipDurationMs: 200,
      dropTargetStyle: {},
      dragDisabled: isTouchDevice,
      type: 'filter-groups',
    }}
    onconsider={handleDndConsider}
    onfinalize={handleDndFinalize}
  >
    {#each dndPills as pill (pill.id)}
      {@const isActive = isPillActive(pill)}
      <button
        type="button"
        class="pill"
        class:active={isActive}
        style="--pill-color: {pill.color}"
        aria-pressed={isActive}
        title={isActive ? `Hide ${pill.name}` : `Show ${pill.name}`}
        onclick={(e) => handleToggle(e, pill)}
      >
        <span class="pill-dot"></span>
        <span class="pill-name">{pill.name}</span>
      </button>
    {/each}
  </div>

  {#if groups.length === 0}
    <button class="empty-cta" onclick={onaddgroup}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      Create your first group
    </button>
  {:else}
    <button class="add-group" onclick={onaddgroup} title="Create new group" aria-label="Create new group">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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

  /* Add-group button uses the same tinted-pill vocabulary as the per-group
     add-collection button in GroupSection and the per-row quick-add in
     TodoRow — but keyed off `--accent` because this button creates a new
     group and has no parent entity to inherit colour from. Kept always
     visible (no hover-reveal) since it's the only "new group" affordance
     in the filter bar. */
  .add-group {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border) 65%);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface) 90%);
    color: var(--accent);
    cursor: pointer;
    transition: background 150ms, border-color 150ms, transform 150ms;
    -webkit-tap-highlight-color: transparent;
  }

  .add-group:hover {
    background: color-mix(in srgb, var(--accent) 22%, var(--surface) 78%);
    border-color: var(--accent);
    transform: scale(1.05);
  }

  .add-group:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
