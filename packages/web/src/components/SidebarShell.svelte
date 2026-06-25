<script lang="ts">
  import type { Snippet } from 'svelte';
  import { get } from 'svelte/store';
  import type { Collection, CollectionGroup } from '@inbox-rs/rs-module';
  import UserMenu from './UserMenu.svelte';
  import LogoShield from './LogoShield.svelte';
  import type { Page, Route } from '../lib/route';
  import { appVersion } from '../lib/plugin-downloads.generated';
  import { autofocus } from '../lib/actions';
  import {
    sortedGroups,
    groupCollections,
    activeGroupIds,
    inactiveCollectionIds,
    toggleGroupFilter,
    toggleCollectionFilter,
    moveItemToCollection,
    createCollection,
    storeGroup,
    items,
  } from '../lib/stores';
  import { draggingItemId, DRAG_MIME } from '../lib/drag';
  import { showToast } from '../lib/toast';

  let {
    route,
    navTo,
    openTodoCount,
    onaddgroup,
    userMenu = $bindable(null),
    children,
  }: {
    route: Route;
    navTo: (page: Page) => void;
    openTodoCount: number;
    onaddgroup: () => void;
    userMenu?: InstanceType<typeof UserMenu> | null;
    children: Snippet;
  } = $props();

  let collapsed = $state(readCollapsed());
  let expandedGroups = $state<Set<string>>(new Set());

  // Inline creation state — no modal, no page switch.
  let addingCollectionFor = $state<string | null>(null);
  let newCollectionName = $state('');
  let addingGroup = $state(false);
  let newGroupName = $state('');

  // Drag-to-file state.
  let dragOverColId = $state<string | null>(null);
  let justFiledColId = $state<string | null>(null);
  let springGroupId: string | null = null;
  let springTimer: ReturnType<typeof setTimeout> | null = null;

  const groups = $derived($sortedGroups);
  const grouped = $derived($groupCollections);
  const activeGroups = $derived($activeGroupIds);
  const inactiveCols = $derived($inactiveCollectionIds);
  const dragging = $derived($draggingItemId !== null);

  function readCollapsed(): boolean {
    try {
      return localStorage.getItem('inbox-rs:sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  }

  function toggleCollapsed() {
    collapsed = !collapsed;
    try {
      localStorage.setItem('inbox-rs:sidebar-collapsed', collapsed ? '1' : '0');
    } catch {
      // storage blocked — collapse just won't persist across reloads
    }
  }

  function toggleGroupExpanded(id: string) {
    const next = new Set(expandedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedGroups = next;
  }

  function expandGroup(id: string) {
    if (expandedGroups.has(id)) return;
    expandedGroups = new Set(expandedGroups).add(id);
  }

  function isActive(page: Page): boolean {
    return route.page === page;
  }

  function isGroupActive(group: CollectionGroup): boolean {
    return activeGroups.has(group.id);
  }

  function isCollectionActive(group: CollectionGroup, col: Collection): boolean {
    return activeGroups.has(group.id) && !inactiveCols.has(col.id);
  }

  function groupCount(group: CollectionGroup): number {
    return (grouped[group.id] ?? []).reduce(
      (n, c) => n + c.itemIds.length,
      0,
    );
  }

  async function onToggleGroup(group: CollectionGroup) {
    try {
      await toggleGroupFilter(group.id);
    } catch (error) {
      console.error('Failed to toggle group filter', error);
    }
  }

  async function onToggleCollection(col: Collection) {
    try {
      await toggleCollectionFilter(col.id);
    } catch (error) {
      console.error('Failed to toggle collection filter', error);
    }
  }

  // ── Inline collection creation ──────────────────────────────────────────
  function startAddCollection(group: CollectionGroup) {
    expandGroup(group.id);
    newCollectionName = '';
    addingCollectionFor = group.id;
  }

  function cancelAddCollection() {
    addingCollectionFor = null;
    newCollectionName = '';
  }

  async function submitCollection(group: CollectionGroup) {
    const name = newCollectionName.trim();
    if (!name) return;
    try {
      await createCollection({
        id: crypto.randomUUID(),
        name,
        itemIds: [],
        createdAt: new Date().toISOString(),
        color: group.color || '#6366f1',
        groupId: group.id,
      });
      // Keep the field open + cleared so several can be added in a row.
      newCollectionName = '';
    } catch (error) {
      console.error('Failed to create collection', error);
    }
  }

  // ── Inline group creation ───────────────────────────────────────────────
  function startAddGroup() {
    newGroupName = '';
    addingGroup = true;
  }

  function cancelAddGroup() {
    addingGroup = false;
    newGroupName = '';
  }

  async function submitGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      await storeGroup({
        id: crypto.randomUUID(),
        name,
        collectionIds: [],
        createdAt: new Date().toISOString(),
        color: '#6366f1',
      });
      newGroupName = '';
      addingGroup = false;
    } catch (error) {
      console.error('Failed to create group', error);
    }
  }

  // ── Drag an inbox item onto a collection to file it ──────────────────────
  function onColDragOver(e: DragEvent, col: Collection) {
    if (!dragging) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dragOverColId = col.id;
  }

  function onColDragLeave(col: Collection) {
    if (dragOverColId === col.id) dragOverColId = null;
  }

  async function onColDrop(e: DragEvent, col: Collection) {
    e.preventDefault();
    dragOverColId = null;
    clearSpring();
    const id = e.dataTransfer?.getData(DRAG_MIME) ?? '';
    draggingItemId.set(null);
    if (!id) return;
    const previousCollectionId = get(items)[id]?.collectionId;
    try {
      await moveItemToCollection(id, col.id);
      justFiledColId = col.id;
      setTimeout(() => {
        if (justFiledColId === col.id) justFiledColId = null;
      }, 1000);
      showToast(`Filed in ${col.name}`, {
        label: 'Undo',
        run: () => {
          void moveItemToCollection(id, previousCollectionId).catch(() => {
            showToast("Couldn't undo — open the item to move it.");
          });
        },
      });
    } catch (error) {
      console.error('Failed to assign item to collection', error);
    }
  }

  // Spring-loaded groups: hovering a dragged item over a collapsed group
  // auto-expands it after a beat so you can reach a nested collection without
  // opening it first. Groups themselves are never drop targets.
  function clearSpring() {
    if (springTimer) clearTimeout(springTimer);
    springTimer = null;
    springGroupId = null;
  }

  function onGroupDragOver(group: CollectionGroup) {
    if (!dragging || expandedGroups.has(group.id)) return;
    if (springGroupId === group.id) return;
    clearSpring();
    springGroupId = group.id;
    springTimer = setTimeout(() => {
      expandGroup(group.id);
      clearSpring();
    }, 550);
  }

  function onGroupDragLeave(group: CollectionGroup) {
    if (springGroupId === group.id) clearSpring();
  }
</script>

<header>
  <div class="header-inner">
    <button
      class="sidebar-toggle"
      type="button"
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-pressed={!collapsed}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      onclick={toggleCollapsed}
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <div class="brand">
      <a class="brand-link" href="#/">
        <h1 class="sr-only">Inbox RS</h1>
        <span class="brand-logo" aria-hidden="true"><LogoShield /></span>
      </a>
    </div>
    <nav class="header-nav" aria-label="Primary">
      <button
        type="button"
        class:active={isActive('inbox')}
        aria-current={isActive('inbox') ? 'page' : undefined}
        onclick={() => navTo('inbox')}
      >Inbox</button>
      <button
        type="button"
        class:active={isActive('todos')}
        aria-current={isActive('todos') ? 'page' : undefined}
        onclick={() => navTo('todos')}
      >
        Todos
        {#if openTodoCount > 0}
          <span class="nav-badge">{openTodoCount}</span>
        {/if}
      </button>
      <button
        type="button"
        class:active={isActive('collections')}
        aria-current={isActive('collections') ? 'page' : undefined}
        onclick={() => navTo('collections')}
      >Collections</button>
    </nav>
    <div class="header-right">
      <UserMenu bind:this={userMenu} />
    </div>
  </div>
</header>

<div class="body" class:sidebar-collapsed={collapsed}>
  {#if route.page !== 'plugins'}
    <aside class="sidebar" class:collapsed class:dragging aria-label="Groups and collections">
      {#if collapsed}
        <div class="rail">
          <button
            class="rail-expand"
            type="button"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onclick={toggleCollapsed}
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          {#each groups as group (group.id)}
            {@const groupActive = isGroupActive(group)}
            <button
              class="rail-dot"
              class:inactive={!groupActive}
              type="button"
              style="--entity-color: {group.color || 'var(--accent)'}"
              aria-pressed={groupActive}
              title={groupActive ? `Hide ${group.name}` : `Show ${group.name}`}
              onclick={() => onToggleGroup(group)}
            >
              <span class="dot"></span>
            </button>
          {/each}
        </div>
      {:else}
        {#if dragging}
          <div class="filing">Filing mode — drop on a collection</div>
        {/if}
        <div class="sidebar-head">
          <span class="sidebar-title">Groups</span>
          <button
            class="add-group-btn"
            type="button"
            onclick={startAddGroup}
            title="New group"
            aria-label="New group"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>

        {#if groups.length === 0 && !addingGroup}
          <button type="button" class="empty-cta" onclick={startAddGroup}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create your first group
          </button>
        {:else}
          <div class="groups">
            {#each groups as group (group.id)}
              {@const cols = grouped[group.id] ?? []}
              {@const groupActive = isGroupActive(group)}
              {@const groupOpen = expandedGroups.has(group.id)}
              <div class="group">
                <div
                  class="group-row"
                  role="presentation"
                  ondragover={() => onGroupDragOver(group)}
                  ondragleave={() => onGroupDragLeave(group)}
                >
                  <button
                    class="chevron"
                    type="button"
                    aria-label={groupOpen ? `Collapse ${group.name}` : `Expand ${group.name}`}
                    aria-expanded={groupOpen}
                    disabled={cols.length === 0}
                    onclick={() => toggleGroupExpanded(group.id)}
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate({groupOpen ? 90 : 0}deg)"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                  <button
                    class="entity group-entity"
                    class:inactive={!groupActive}
                    type="button"
                    style="--entity-color: {group.color || 'var(--accent)'}"
                    aria-pressed={groupActive}
                    title={groupActive ? `Hide ${group.name}` : `Show ${group.name}`}
                    onclick={() => onToggleGroup(group)}
                  >
                    <span class="dot"></span>
                    <span class="entity-name">{group.name}</span>
                    <span class="count">{groupCount(group)}</span>
                  </button>
                  <button
                    class="row-add"
                    type="button"
                    title={`Add collection to ${group.name}`}
                    aria-label={`Add collection to ${group.name}`}
                    onclick={() => startAddCollection(group)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </button>
                </div>

                {#if groupOpen}
                  <div class="collections">
                    {#if cols.length === 0 && addingCollectionFor !== group.id}
                      <p class="collections-empty">No collections</p>
                    {:else}
                      {#each cols as col (col.id)}
                        {@const colActive = isCollectionActive(group, col)}
                        <button
                          class="entity collection-entity"
                          class:inactive={!colActive}
                          class:drop-target={dragging}
                          class:drop-over={dragOverColId === col.id}
                          class:just-filed={justFiledColId === col.id}
                          type="button"
                          style="--entity-color: {col.color || group.color || 'var(--accent)'}"
                          aria-pressed={colActive}
                          title={colActive ? `Hide ${col.name}` : `Show ${col.name}`}
                          onclick={() => onToggleCollection(col)}
                          ondragover={(e) => onColDragOver(e, col)}
                          ondragleave={() => onColDragLeave(col)}
                          ondrop={(e) => onColDrop(e, col)}
                        >
                          <span class="dot"></span>
                          <span class="entity-name">{col.name}</span>
                          <span class="drop-label">File here</span>
                          <span class="count">{col.itemIds.length}</span>
                        </button>
                      {/each}
                    {/if}

                    {#if addingCollectionFor === group.id}
                      <div class="inline-add">
                        <span class="dot" style="background: var(--text-muted)"></span>
                        <input
                          use:autofocus
                          bind:value={newCollectionName}
                          placeholder="Name a collection…"
                          onkeydown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); void submitCollection(group); }
                            else if (e.key === 'Escape') { e.preventDefault(); cancelAddCollection(); }
                          }}
                          onblur={cancelAddCollection}
                        />
                        <span class="inline-hint">↵ add · esc</span>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}

            {#if addingGroup}
              <div class="inline-add inline-add--group">
                <span class="dot" style="background: var(--text-muted)"></span>
                <input
                  use:autofocus
                  bind:value={newGroupName}
                  placeholder="Name a group…"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void submitGroup(); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelAddGroup(); }
                  }}
                  onblur={cancelAddGroup}
                />
                <span class="inline-hint">↵ add · esc</span>
              </div>
            {:else}
              <button type="button" class="new-group" onclick={startAddGroup}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New group
              </button>
            {/if}
          </div>
        {/if}
      {/if}
    </aside>
  {/if}

  <main>
    {@render children()}
  </main>
</div>

<footer class="app-footer">
  <div class="app-footer-inner">
    <span class="footer-brand">Inbox RS</span>
    <span class="footer-version">v{appVersion}</span>
    <span class="footer-sep">·</span>
    <a class="footer-link" class:active={isActive('plugins')} href="#/plugins">
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Downloads
    </a>
    <span class="footer-sep">·</span>
    <a class="footer-link" href="https://github.com/silverbucket/inbox-rs" target="_blank" rel="noopener noreferrer">
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
      GitHub
    </a>
  </div>
</footer>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* ── Header ── */
  header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    width: 100%;
  }

  .header-inner {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem 1.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .sidebar-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
    transition: color 150ms, border-color 150ms, background 150ms;
  }

  .sidebar-toggle:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  }

  .brand {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .brand-link {
    display: flex;
    align-items: center;
    color: inherit;
  }

  .brand-logo {
    display: inline-flex;
    height: 38px;
    width: auto;
  }

  .brand-logo :global(svg) {
    height: 38px;
    width: auto;
  }

  .header-nav {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
    flex-shrink: 0;
  }

  .header-nav button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2rem;
    padding: 0 0.9rem;
    border-radius: 999px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.92rem;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: background 180ms ease, color 180ms ease;
  }

  .header-nav button:hover {
    color: var(--text);
  }

  .header-nav button.active {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 18%, var(--surface) 82%);
  }

  .nav-badge {
    font-size: 0.65rem;
    font-weight: 700;
    color: white;
    background: var(--accent);
    min-width: 18px;
    height: 18px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 5px;
    line-height: 1;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
    margin-left: auto;
  }

  /* ── Body: sidebar + main ── */
  .body {
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
    flex: 1;
    display: grid;
    grid-template-columns: 268px minmax(0, 1fr);
    align-items: start;
  }

  .body.sidebar-collapsed {
    grid-template-columns: 60px minmax(0, 1fr);
  }

  /* ── Sidebar ── */
  .sidebar {
    position: sticky;
    top: 70px;
    align-self: start;
    padding: 1rem 0.65rem 1rem 1rem;
    border-right: 1px solid var(--border);
    min-height: calc(100vh - 70px);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent) 3%, var(--bg)),
      var(--bg)
    );
  }

  .sidebar.collapsed {
    padding: 0.85rem 0.5rem;
  }

  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
  }

  .rail-expand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    margin-bottom: 0.35rem;
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
  }

  .rail-expand:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  }

  /* Collapsed rail: a group is a colour circle — full when active, faded when
     switched off. Click to toggle, same as the expanded row. */
  .rail-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 50%;
    background: none;
    cursor: pointer;
    transition: background 150ms;
  }

  .rail-dot:hover {
    background: var(--surface-hover);
  }

  .filing {
    margin: 0 0.25rem 0.5rem;
    padding: 0.4rem 0.6rem;
    border-radius: 0.5rem;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .sidebar-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.25rem;
    margin-bottom: 0.5rem;
  }

  .sidebar-title {
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .add-group-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border) 70%);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--accent);
    cursor: pointer;
    transition: background 150ms, transform 150ms;
  }

  .add-group-btn:hover {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    transform: scale(1.05);
  }

  .groups {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
  }

  .group-row {
    display: flex;
    align-items: center;
    gap: 0.05rem;
    border-radius: 0.5rem;
  }

  .group-row:hover {
    background: var(--surface-hover);
  }

  .chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 28px;
    flex-shrink: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 6px;
  }

  .chevron svg {
    transition: transform 160ms ease;
  }

  .chevron:disabled {
    opacity: 0.25;
    cursor: default;
  }

  .entity {
    flex: 1 1 auto;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.9rem;
    padding: 0 0.55rem;
    border: 1px solid transparent;
    border-radius: 0.5rem;
    background: none;
    color: var(--text);
    font-size: 0.9rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: background 150ms, color 150ms, opacity 150ms;
  }

  .entity:hover {
    background: var(--surface-hover);
  }

  .group-entity {
    font-weight: 700;
  }

  .collection-entity {
    font-weight: 500;
    font-size: 0.86rem;
    margin-left: 1.55rem;
  }

  .entity.inactive {
    opacity: 0.42;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--entity-color);
    flex-shrink: 0;
  }

  /* Larger dot for the collapsed rail (declared after the base `.dot` so the
     higher-specificity selector wins without a descending-specificity lint). */
  .rail-dot .dot {
    width: 14px;
    height: 14px;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--entity-color) 18%, transparent);
  }

  .rail-dot.inactive .dot {
    opacity: 0.35;
    box-shadow: none;
  }

  .entity-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    margin-left: auto;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-muted);
  }

  .group-entity .count {
    background: var(--surface-hover);
    border-radius: 999px;
    padding: 0 0.4rem;
  }

  /* Reveal the per-group add button on hover only, to keep things quiet. */
  .row-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    border-radius: 6px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 150ms, color 150ms, background 150ms;
  }

  .group-row:hover .row-add,
  .row-add:focus-visible {
    opacity: 1;
  }

  .row-add:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .collections {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    padding: 0.05rem 0 0.35rem;
  }

  .collections-empty {
    margin: 0;
    padding: 0.2rem 0 0.2rem 1.9rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    font-style: italic;
  }

  /* ── Drag-to-file affordances ── */
  .drop-label {
    display: none;
    margin-left: auto;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--entity-color);
  }

  .collection-entity.drop-target {
    opacity: 1;
    outline: 1px dashed
      color-mix(in srgb, var(--entity-color) 55%, var(--border));
    outline-offset: -1px;
  }

  .collection-entity.drop-over {
    background: color-mix(in srgb, var(--entity-color) 20%, var(--surface));
    outline: 2px solid var(--entity-color);
    transform: translateX(2px) scale(1.015);
    box-shadow: 0 4px 14px
      color-mix(in srgb, var(--entity-color) 35%, transparent);
  }

  .collection-entity.drop-over .count {
    display: none;
  }

  .collection-entity.drop-over .drop-label {
    display: inline;
  }

  /* Group rows recede while filing, since you can only drop on collections. */
  .sidebar.dragging .group-entity {
    opacity: 0.5;
  }

  .collection-entity.just-filed {
    animation: filed-pulse 1s ease;
  }

  @keyframes filed-pulse {
    0% {
      background: color-mix(in srgb, var(--entity-color) 35%, var(--surface));
    }
    100% {
      background: none;
    }
  }

  /* ── Inline create input ── */
  .inline-add {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: 1.55rem;
    margin-top: 0.1rem;
    padding: 0.28rem 0.55rem;
    border: 1px solid var(--accent);
    border-radius: 0.5rem;
    background: var(--surface);
  }

  .inline-add--group {
    margin-left: 0;
    margin-top: 0.5rem;
  }

  .inline-add input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: none;
    /* Inherit the >=1rem body size — an explicit sub-1rem size would trip the
       iOS Safari focus-zoom guard (see input-font-size.test.ts). */
    font: inherit;
    color: var(--text);
  }

  .inline-hint {
    font-size: 0.68rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .empty-cta {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: 1px dashed var(--border);
    color: var(--text-muted);
    padding: 0.45rem 0.85rem;
    border-radius: 0.6rem;
    font-size: 0.85rem;
    cursor: pointer;
    transition: color 150ms, border-color 150ms;
  }

  .empty-cta:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .new-group {
    margin-top: 0.6rem;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: 1px dashed var(--border);
    border-radius: 0.5rem;
    background: none;
    color: var(--text-muted);
    font-size: 0.84rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 150ms, border-color 150ms;
  }

  .new-group:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  /* ── Main ── */
  main {
    padding: 1.5rem;
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  @media (max-width: 768px) {
    .header-inner {
      flex-wrap: wrap;
      padding: 0.75rem 1rem;
    }

    .body,
    .body.sidebar-collapsed {
      grid-template-columns: 1fr;
    }

    .sidebar {
      position: static;
      min-height: 0;
      border-right: none;
      border-bottom: 1px solid var(--border);
      padding: 0.75rem 1rem;
    }

    main {
      padding: 1rem;
    }
  }

  /* ── Footer ── */
  .app-footer {
    border-top: 1px solid var(--border);
    margin-top: 2rem;
    padding: 1rem 1.5rem;
  }

  .app-footer-inner {
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .footer-brand {
    font-weight: 700;
    font-size: 0.82rem;
    color: var(--text);
  }

  .footer-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text-muted);
    font-size: 0.82rem;
    transition: color 180ms ease;
  }

  .footer-link:hover,
  .footer-link.active {
    color: var(--text);
  }

  .footer-link svg {
    flex-shrink: 0;
  }

  .footer-sep {
    opacity: 0.35;
  }

  .footer-version {
    font-weight: 700;
    font-size: 0.78rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--border) 75%, white 25%);
    background: color-mix(in srgb, var(--surface) 86%, black 14%);
    letter-spacing: 0.02em;
  }
</style>
