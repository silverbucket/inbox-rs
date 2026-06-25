<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Collection, CollectionGroup } from '@inbox-rs/rs-module';
  import UserMenu from './UserMenu.svelte';
  import LogoShield from './LogoShield.svelte';
  import type { Page, Route } from '../lib/route';
  import { appVersion } from '../lib/plugin-downloads.generated';
  import {
    sortedGroups,
    groupCollections,
    activeGroupIds,
    inactiveCollectionIds,
    toggleGroupFilter,
    toggleCollectionFilter,
  } from '../lib/stores';

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

  // Whole-sidebar collapse (rail vs expanded). Local + device-persisted.
  let collapsed = $state(readCollapsed());
  // Per-group expand/collapse of the collection list underneath each group.
  let expandedGroups = $state<Set<string>>(new Set());

  const groups = $derived($sortedGroups);
  const grouped = $derived($groupCollections);
  const activeGroups = $derived($activeGroupIds);
  const inactiveCols = $derived($inactiveCollectionIds);

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

  function isActive(page: Page): boolean {
    return route.page === page;
  }

  function isGroupActive(group: CollectionGroup): boolean {
    return activeGroups.has(group.id);
  }

  // A collection is "on" when its own switch is on AND its group is active.
  // Toggling the switch only flips the collection's own deny-list entry.
  function isCollectionActive(group: CollectionGroup, col: Collection): boolean {
    return activeGroups.has(group.id) && !inactiveCols.has(col.id);
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
    <aside class="sidebar" class:collapsed aria-label="Groups and collections">
      {#if collapsed}
        <button
          class="rail-expand"
          type="button"
          aria-label="Expand sidebar"
          title="Expand sidebar"
          onclick={toggleCollapsed}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      {:else}
        <div class="sidebar-head">
          <span class="sidebar-title">Groups</span>
          <button
            class="add-group"
            type="button"
            onclick={onaddgroup}
            title="Create new group"
            aria-label="Create new group"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>

        {#if groups.length === 0}
          <button type="button" class="empty-cta" onclick={onaddgroup}>
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
                <div class="group-row">
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
                  </button>
                </div>

                {#if groupOpen}
                  <div class="collections">
                    {#if cols.length === 0}
                      <p class="collections-empty">No collections</p>
                    {:else}
                      {#each cols as col (col.id)}
                        {@const colActive = isCollectionActive(group, col)}
                        <button
                          class="entity collection-entity"
                          class:inactive={!colActive}
                          type="button"
                          style="--entity-color: {col.color || group.color || 'var(--accent)'}"
                          aria-pressed={colActive}
                          title={colActive ? `Hide ${col.name}` : `Show ${col.name}`}
                          onclick={() => onToggleCollection(col)}
                        >
                          <span class="dot"></span>
                          <span class="entity-name">{col.name}</span>
                        </button>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
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

  /* ── Header (same vocabulary as ClassicShell, minus the filter row) ── */
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
    grid-template-columns: 248px minmax(0, 1fr);
    align-items: start;
  }

  .body.sidebar-collapsed {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  /* ── Sidebar ── */
  .sidebar {
    position: sticky;
    top: 70px;
    align-self: start;
    padding: 1.25rem 0.75rem 1.25rem 1.25rem;
    border-right: 1px solid var(--border);
    min-height: calc(100vh - 70px);
  }

  .sidebar.collapsed {
    padding: 1rem 0.5rem;
    display: flex;
    justify-content: center;
  }

  .rail-expand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
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

  .sidebar-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .sidebar-title {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .add-group {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border) 65%);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface) 90%);
    color: var(--accent);
    cursor: pointer;
    transition: background 150ms, border-color 150ms, transform 150ms;
  }

  .add-group:hover {
    background: color-mix(in srgb, var(--accent) 22%, var(--surface) 78%);
    border-color: var(--accent);
    transform: scale(1.05);
  }

  .groups {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .group-row {
    display: flex;
    align-items: center;
    gap: 0.1rem;
  }

  .chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 28px;
    flex-shrink: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .chevron svg {
    transition: transform 150ms ease;
  }

  .chevron:disabled {
    opacity: 0.25;
    cursor: default;
  }

  /* Shared toggle pill for both groups and collections. */
  .entity {
    flex: 1 1 auto;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.9rem;
    padding: 0 0.6rem;
    border: 1px solid transparent;
    border-radius: 0.55rem;
    background: none;
    color: var(--text);
    font-size: 0.9rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: background 150ms, color 150ms, opacity 150ms;
  }

  .entity:hover {
    background: var(--surface-hover, color-mix(in srgb, var(--surface) 70%, var(--bg)));
  }

  .group-entity {
    font-weight: 700;
  }

  .collection-entity {
    font-weight: 500;
    font-size: 0.86rem;
    margin-left: 1.4rem;
  }

  .entity.inactive {
    opacity: 0.45;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--entity-color);
    flex-shrink: 0;
  }

  .entity-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .collections {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.1rem 0 0.35rem;
  }

  .collections-empty {
    margin: 0;
    padding: 0.2rem 0 0.2rem 1.9rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    font-style: italic;
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

  /* ── Main ── */
  main {
    padding: 1.5rem;
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* ── Mobile: collapse the sidebar to a rail by default ── */
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

  /* ── Footer (shared with ClassicShell vocabulary) ── */
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
