<script lang="ts">
  import type { Collection } from '@inbox-rs/rs-module';
  import { get } from 'svelte/store';
  import {
    appConfig,
    createCollection,
    groupCollections,
    groups,
    items,
    orphanCollections,
    sortedGroups,
    updateConfig,
  } from '../lib/stores';
  import {
    getRecentCollectionIds,
    suggestCollections,
    type FilingSubject,
    type SuggestionReason,
  } from '../lib/collection-suggest';
  import { autofocusIf } from '../lib/actions';
  import { randomPresetColor } from '../lib/constants';

  let {
    item,
    mode = 'move',
    onpick,
    onclose,
  }: {
    /** Any InboxItem, or a lightweight subject for not-yet-saved items. */
    item: FilingSubject;
    /**
     * 'move' — re-file the card; shows Inbox/Unfile when it's already filed.
     * 'todo' — choosing where a converted todo lands; always offers Unfiled.
     */
    mode?: 'move' | 'todo';
    /** `undefined` collectionId = Inbox / Unfiled. */
    onpick: (collectionId: string | undefined) => void;
    onclose: () => void;
  } = $props();

  let query = $state('');
  let showCreate = $state(false);
  let createName = $state('');
  let creating = $state(false);
  let createError = $state('');

  // Autofocusing the search field pops the keyboard over half the sheet on
  // touch devices — desktop-only.
  const isCoarse =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  const isTodoish = $derived(item.isTodo || item.type === 'todo');
  const title = $derived(
    mode === 'todo'
      ? 'File todo'
      : item.collectionId
        ? 'Move to collection'
        : 'File into collection',
  );
  const unfiledLabel = $derived(
    mode === 'todo' || isTodoish ? 'Unfiled' : 'Inbox',
  );
  const showUnfiled = $derived(mode === 'todo' || !!item.collectionId);

  const allCollections = $derived([
    ...$sortedGroups.flatMap((g) => $groupCollections[g.id] ?? []),
    ...$orphanCollections,
  ]);

  // Suggestions only lead when the user isn't already narrowing by hand.
  const suggestions = $derived(
    query.trim()
      ? []
      : suggestCollections(item, allCollections, $items, getRecentCollectionIds()),
  );

  const REASON_LABEL: Record<SuggestionReason, string> = {
    site: 'matches site',
    name: 'matches name',
    recent: 'recent',
  };

  /** Groups with their collections, filtered by the query, current home excluded. */
  const filteredGroups = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return $sortedGroups
      .map((group) => ({
        group,
        cols: ($groupCollections[group.id] ?? []).filter(
          (col) =>
            col.id !== item.collectionId &&
            (!q ||
              col.name.toLowerCase().includes(q) ||
              group.name.toLowerCase().includes(q)),
        ),
      }))
      .filter(({ cols }) => cols.length > 0);
  });

  /** Ungrouped collections, query-filtered — rendered under "Other". */
  const filteredOrphans = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return $orphanCollections.filter(
      (col) =>
        col.id !== item.collectionId &&
        (!q || col.name.toLowerCase().includes(q)),
    );
  });

  const hasAnyCollections = $derived(allCollections.length > 0);
  const queryHasExactMatch = $derived(
    allCollections.some(
      (c) => c.name.toLowerCase() === query.trim().toLowerCase(),
    ),
  );

  function pickInitialGroupId(): string {
    const allGroups = get(groups);
    const last = get(appConfig).lastSelectedGroupId;
    if (last && allGroups[last]) return last;
    return get(sortedGroups)[0]?.id ?? '';
  }

  let createGroupId = $state<string>(pickInitialGroupId());

  function openCreate() {
    createName = query.trim();
    createGroupId = pickInitialGroupId();
    createError = '';
    showCreate = true;
  }

  async function handleCreate() {
    const name = createName.trim();
    if (!name || !createGroupId || creating) return;
    creating = true;
    createError = '';
    try {
      const col: Collection = {
        id: crypto.randomUUID(),
        name,
        itemIds: [],
        createdAt: new Date().toISOString(),
        color: randomPresetColor(),
        groupId: createGroupId,
      };
      await createCollection(col);
      // Remember the group like CollectionFormModal does — best-effort.
      try {
        await updateConfig({ lastSelectedGroupId: createGroupId });
      } catch (e) {
        console.error('Failed to persist lastSelectedGroupId', e);
      }
      onpick(col.id);
    } catch (e) {
      console.error('Failed to create collection', e);
      createError =
        e instanceof Error ? e.message : 'Failed to create collection';
      creating = false;
    }
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    const first = filteredGroups[0]?.cols[0] ?? filteredOrphans[0];
    if (query.trim() && first) {
      onpick(first.id);
    } else if (query.trim() && !queryHasExactMatch) {
      openCreate();
    }
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    // Peel one layer: the inline create form first, then the picker.
    if (showCreate) {
      showCreate = false;
      return;
    }
    onclose();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose}>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="head">
      <span class="picker-title">{title}</span>
      <button type="button" class="btn-close" aria-label="Close" onclick={onclose}>
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    {#if showCreate}
      <div class="create-form">
        <label class="create-label" for="picker-new-name">New collection</label>
        <input
          id="picker-new-name"
          use:autofocusIf={!isCoarse}
          type="text"
          class="create-input"
          bind:value={createName}
          placeholder="Collection name"
          onkeydown={(e) => {
            if (e.key === 'Enter') handleCreate();
          }}
        />
        {#if $sortedGroups.length > 0}
          <select
            class="create-select"
            aria-label="Group"
            bind:value={createGroupId}
          >
            {#each $sortedGroups as g (g.id)}
              <option value={g.id}>{g.name}</option>
            {/each}
          </select>
        {:else}
          <p class="empty">No groups yet — create one in the filter bar first.</p>
        {/if}
        {#if createError}
          <p class="error" role="status" aria-live="polite">{createError}</p>
        {/if}
        <div class="create-actions">
          <button
            type="button"
            class="btn-cancel"
            onclick={() => (showCreate = false)}>Back</button
          >
          <button
            type="button"
            class="btn-create"
            disabled={!createName.trim() || !createGroupId || creating}
            onclick={handleCreate}
          >
            {creating ? 'Creating…' : 'Create & file'}
          </button>
        </div>
      </div>
    {:else}
      <div class="search-wrap">
        <svg
          aria-hidden="true"
          class="search-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          use:autofocusIf={!isCoarse}
          type="text"
          class="search"
          bind:value={query}
          placeholder={hasAnyCollections
            ? 'Search or create a collection…'
            : 'Name your first collection…'}
          onkeydown={handleSearchKeydown}
        />
      </div>

      <div class="list">
        {#if showUnfiled && !query.trim()}
          <button
            type="button"
            class="option"
            onclick={() => onpick(undefined)}
          >
            <span class="dot" style="background: #9ca3af"></span>
            {unfiledLabel}
          </button>
          <div class="rule"></div>
        {/if}

        {#if suggestions.length > 0}
          <div class="group-label suggested">
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 3l1.6 4.8L18 9l-4.4 1.2L12 15l-1.6-4.8L6 9l4.4-1.2z"
              ></path>
            </svg>
            Suggested
          </div>
          {#each suggestions as sugg (sugg.collection.id)}
            <button
              type="button"
              class="option"
              onclick={() => onpick(sugg.collection.id)}
            >
              <span
                class="dot"
                style="background: {sugg.collection.color || '#6366f1'}"
              ></span>
              <span class="col-name">{sugg.collection.name}</span>
              <span class="suggestion-group">
                {$groups[sugg.collection.groupId ?? '']?.name ?? 'Other'}
              </span>
              <span class="reason">{REASON_LABEL[sugg.reason]}</span>
            </button>
          {/each}
          {#if filteredGroups.length > 0}
            <div class="group-label">All collections</div>
          {/if}
        {/if}

        {#each filteredGroups as { group, cols } (group.id)}
          <div class="group-label" style="color: {group.color || 'var(--text-muted)'}">
            {group.name}
          </div>
          {#each cols as col (col.id)}
            <button type="button" class="option" onclick={() => onpick(col.id)}>
              <span class="dot" style="background: {col.color || '#6366f1'}"></span>
              <span class="col-name">{col.name}</span>
              <span class="count">{col.itemIds.length}</span>
            </button>
          {/each}
        {/each}

        {#if filteredOrphans.length > 0}
          <div class="group-label">Other</div>
          {#each filteredOrphans as col (col.id)}
            <button type="button" class="option" onclick={() => onpick(col.id)}>
              <span class="dot" style="background: {col.color || '#6366f1'}"></span>
              <span class="col-name">{col.name}</span>
              <span class="count">{col.itemIds.length}</span>
            </button>
          {/each}
        {/if}

        {#if hasAnyCollections && query.trim() && filteredGroups.length === 0 && filteredOrphans.length === 0}
          <div class="empty">No matching collections</div>
        {/if}

        <div class="rule"></div>
        <button type="button" class="option create-option" onclick={openCreate}>
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          {#if query.trim() && !queryHasExactMatch}
            Create “{query.trim()}”
          {:else}
            New collection…
          {/if}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: var(--overlay);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 4rem 1rem 1rem;
    overscroll-behavior: contain;
  }

  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 12px 36px var(--shadow);
    width: 100%;
    max-width: 400px;
    max-height: min(28rem, calc(100vh - 6rem));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sheet-handle {
    display: none;
  }

  /* Bottom sheet on touch-sized screens and installed PWA. */
  @media (max-width: 600px), (display-mode: standalone) {
    .overlay {
      align-items: flex-end;
      padding: 0;
    }

    .panel {
      max-width: none;
      max-height: 78dvh;
      border-left: none;
      border-right: none;
      border-bottom: none;
      border-radius: 18px 18px 0 0;
      padding-bottom: env(safe-area-inset-bottom);
    }

    .sheet-handle {
      display: block;
      width: 40px;
      height: 5px;
      border-radius: 3px;
      background: var(--border);
      margin: 0.5rem auto 0;
      flex-shrink: 0;
    }
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem 0.35rem;
  }

  .picker-title {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .btn-close {
    background: none;
    border: none;
    color: var(--text-muted);
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    display: grid;
    place-items: center;
    cursor: pointer;
  }

  .btn-close:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .search-wrap {
    position: relative;
    padding: 0 1rem 0.6rem;
    flex-shrink: 0;
  }

  .search-icon {
    position: absolute;
    left: 1.65rem;
    top: 50%;
    transform: translateY(calc(-50% - 0.3rem));
    color: var(--text-muted);
    pointer-events: none;
  }

  .search {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    padding: 0.5rem 0.65rem 0.5rem 2.1rem;
    /* >=1rem avoids the iOS Safari focus-zoom on touch devices. */
    font-size: 1rem;
    font-family: inherit;
  }

  .search:focus {
    outline: none;
    border-color: var(--accent);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 0.5rem 0.6rem;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.55rem;
    border: none;
    background: none;
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: var(--radius-sm);
    text-align: left;
  }

  @media (pointer: coarse) {
    .option {
      padding-top: 0.65rem;
      padding-bottom: 0.65rem;
    }
  }

  .option:hover {
    background: var(--accent-subtler);
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .col-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .suggestion-group {
    max-width: 35%;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 0.72rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Amber "why" tag. Dark is the app default; light overrides mirror the
     token pattern in global.css (media query + explicit data-theme). */
  .reason {
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: #f59e0b;
    background: color-mix(in srgb, #f59e0b 16%, transparent);
    padding: 0.12rem 0.4rem;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .group-label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.55rem 0.55rem 0.25rem;
    font-size: 0.62rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .group-label.suggested {
    color: #f59e0b;
  }

  @media (prefers-color-scheme: light) {
    :global(:root:not([data-theme='dark'])) .reason,
    :global(:root:not([data-theme='dark'])) .group-label.suggested {
      color: #b45309;
    }
  }

  :global(:root[data-theme='light']) .reason,
  :global(:root[data-theme='light']) .group-label.suggested {
    color: #b45309;
  }

  .rule {
    height: 1px;
    background: var(--border);
    margin: 0.3rem 0.3rem;
  }

  .create-option {
    color: var(--accent);
    font-weight: 500;
  }

  .empty {
    padding: 0.6rem 0.55rem;
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .error {
    padding: 0.2rem 0.55rem 0.4rem;
    font-size: 0.8rem;
    color: var(--danger);
  }

  /* Inline create form */
  .create-form {
    padding: 0.35rem 1rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .create-label {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .create-input,
  .create-select {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    padding: 0.5rem 0.65rem;
    font-size: 1rem;
    font-family: inherit;
  }

  .create-input:focus,
  .create-select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .create-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.2rem;
  }

  .btn-cancel {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem 0.9rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
  }

  .btn-cancel:hover {
    border-color: var(--text-muted);
  }

  .btn-create {
    background: var(--accent);
    border: none;
    color: white;
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
  }

  .btn-create:hover {
    opacity: 0.9;
  }

  .btn-create:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
