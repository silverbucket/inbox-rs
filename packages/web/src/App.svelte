<script lang="ts">
  import { onMount } from 'svelte';
  import type { InboxItemType, InboxItem, Collection, CollectionGroup } from '@inbox-rs/rs-module';
  import ConnectWidget from './components/ConnectWidget.svelte';
  import InboxGrid from './components/InboxGrid.svelte';
  import TodoList from './components/TodoList.svelte';
  import AddEntryBar from './components/AddEntryBar.svelte';
  import AddEntryModal from './components/AddEntryModal.svelte';
  import ViewCardModal from './components/ViewCardModal.svelte';
  import MigrationAlert from './components/MigrationAlert.svelte';
  import PluginsPage from './components/PluginsPage.svelte';
  import CollectionsPage from './components/CollectionsPage.svelte';
  import CollectionFormModal from './components/CollectionFormModal.svelte';
  import GroupFormModal from './components/GroupFormModal.svelte';
  import { connected, deleteItem, todoItems, appConfig, updateConfig, pendingMigrationCount, runAllMigrations, storeCollection, sortedGroups, storeGroup, moveCollectionToGroup } from './lib/stores';
  import { pluginArtifactVersion } from './lib/plugin-downloads.generated';
  import logoShield from './assets/logos/logo-shield.svg';

  type Route =
    | { page: 'home' }
    | { page: 'plugins' }
    | { page: 'collections' }
    | { page: 'group'; groupId: string };

  let activeModal = $state<InboxItemType | null>(null);
  let editingItem = $state<InboxItem | undefined>(undefined);
  let viewingItem = $state<InboxItem | null>(null);
  let todosExpanded = $state(false);
  let showCollectionForm = $state(false);
  let showGroupForm = $state(false);

  function getRouteFromHash(): Route {
    if (typeof window === 'undefined') return { page: 'home' };
    const hash = window.location.hash;
    if (hash === '#/plugins') return { page: 'plugins' };
    if (hash === '#/collections') return { page: 'collections' };
    const groupMatch = hash.match(/^#\/group\/(.+)$/);
    if (groupMatch) return { page: 'group', groupId: groupMatch[1] };
    return { page: 'home' };
  }

  let route = $state<Route>(getRouteFromHash());
  let userToggledTodos = false;

  // React to config/todo changes to set default expand state,
  // but stop once the user has manually toggled.
  $effect(() => {
    if (userToggledTodos) return;
    const config = $appConfig;
    if (config.todosCollapsed !== undefined) {
      todosExpanded = !config.todosCollapsed;
    } else {
      todosExpanded = $todoItems.some(t => !t.completed);
    }
  });

  onMount(() => {
    const syncRoute = () => {
      route = getRouteFromHash();
    };

    syncRoute();
    window.addEventListener('hashchange', syncRoute);

    return () => {
      window.removeEventListener('hashchange', syncRoute);
    };
  });

  $effect(() => {
    if (route.page === 'home') return;
    activeModal = null;
    editingItem = undefined;
    viewingItem = null;
  });

  function handleTodoExpandChange(v: boolean) {
    userToggledTodos = true;
    todosExpanded = v;
    void updateConfig({ todosCollapsed: !v });
  }

  // Lock body scroll when any modal is open (including iOS Safari)
  const anyModalOpen = $derived(!!viewingItem || !!activeModal || showCollectionForm || showGroupForm);
  let savedScrollY = 0;
  let wasModalOpen = false;

  $effect(() => {
    if (anyModalOpen && !wasModalOpen) {
      // false→true: capture scroll position and lock
      savedScrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';
    } else if (!anyModalOpen && wasModalOpen) {
      // true→false: unlock and restore scroll position
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.overflow = '';
      window.scrollTo(0, savedScrollY);
    }
    wasModalOpen = anyModalOpen;
  });

  function openAdd(type: InboxItemType) {
    editingItem = undefined;
    activeModal = type;
  }

  function openView(item: InboxItem) {
    viewingItem = item;
  }

  function openEditFromView(item: InboxItem) {
    viewingItem = null;
    editingItem = item;
    activeModal = item.type;
  }

  function closeViewModal() {
    viewingItem = null;
  }

  function closeModal() {
    activeModal = null;
    editingItem = undefined;
  }

  async function handleCreateCollection(col: Collection) {
    try {
      await storeCollection(col);
      if (col.groupId) {
        await moveCollectionToGroup(col.id, col.groupId);
      }
      showCollectionForm = false;
    } catch (error) {
      console.error('Failed to create collection', error);
    }
  }

  async function handleCreateGroup(group: CollectionGroup) {
    try {
      await storeGroup(group);
      showGroupForm = false;
      window.location.hash = `#/group/${group.id}`;
    } catch (error) {
      console.error('Failed to create group', error);
    }
  }
</script>

<header>
  <div class="header-inner">
    <div class="brand">
      <a class="brand-link" href="#/">
        <h1 class="sr-only">Inbox RS</h1>
        <img src={logoShield} alt="" aria-hidden="true" class="brand-logo" />
      </a>
    </div>
    <nav class="header-nav" aria-label="Primary">
      <a class:active={route.page === 'home'} aria-current={route.page === 'home' ? 'page' : undefined} href="#/">Inbox</a>
      <a class:active={route.page === 'collections'} aria-current={route.page === 'collections' ? 'page' : undefined} href="#/collections">Collections</a>
      {#if $connected}
        {#each $sortedGroups as group (group.id)}
          <a
            class="group-link"
            class:active={route.page === 'group' && route.groupId === group.id}
            aria-current={route.page === 'group' && route.groupId === group.id ? 'page' : undefined}
            href="#/group/{group.id}"
            style="--group-color: {group.color || 'var(--accent)'}"
          >
            <span class="group-dot"></span>
            <span class="group-name">{group.name}</span>
          </a>
        {/each}
        <button class="nav-add-group" onclick={() => showGroupForm = true} title="New group" aria-label="Create new group">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      {/if}
    </nav>
    <div class="header-right">
      <ConnectWidget />
    </div>
  </div>
</header>

<main>
  {#if route.page === 'plugins'}
    <PluginsPage />
  {:else if route.page === 'collections'}
    {#if $connected}
      <CollectionsPage onselect={openView} oncreate={() => showCollectionForm = true} />
    {:else}
      <div class="empty-state">
        <div class="empty-icon">📥</div>
        <h2>Connect your storage</h2>
        <p>Enter your remoteStorage address above to view your collections.</p>
      </div>
    {/if}
  {:else if route.page === 'group'}
    {#if $connected}
      <CollectionsPage onselect={openView} oncreate={() => showCollectionForm = true} groupId={route.groupId} />
    {:else}
      <div class="empty-state">
        <div class="empty-icon">📥</div>
        <h2>Connect your storage</h2>
        <p>Enter your remoteStorage address above to view your collections.</p>
      </div>
    {/if}
  {:else}
    {#if $connected}
      {#if $pendingMigrationCount > 0}
        <MigrationAlert count={$pendingMigrationCount} onrun={runAllMigrations} />
      {/if}

      <div class="content-layout" class:todos-collapsed={!todosExpanded}>
        {#if todosExpanded}
          <aside class="sidebar">
            <TodoList onselect={openView} onadd={() => openAdd('todo')} onexpandchange={handleTodoExpandChange} />
          </aside>
        {/if}
        <div class="inbox-area">
          <div class="inbox-top">
            {#if !todosExpanded}
              <TodoList onselect={openView} onadd={() => openAdd('todo')} onexpandchange={handleTodoExpandChange} inline />
            {/if}
            <AddEntryBar onadd={openAdd} />
          </div>
          <InboxGrid onselect={openView} />
        </div>
      </div>
    {:else}
      <div class="empty-state">
        <div class="empty-icon">📥</div>
        <h2>Connect your storage</h2>
        <p>Enter your remoteStorage address above to view your inbox.</p>
      </div>
    {/if}
  {/if}
</main>

<footer class="app-footer">
  <div class="app-footer-inner">
    <span class="footer-brand">Inbox RS</span>
    <span class="footer-version">v{pluginArtifactVersion}</span>
    <span class="footer-sep">·</span>
    <a class="footer-link" class:active={route.page === 'plugins'} href="#/plugins">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Downloads
    </a>
    <span class="footer-sep">·</span>
    <a class="footer-link" href="https://github.com/silverbucket/inbox-rs" target="_blank" rel="noopener noreferrer">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
      GitHub
    </a>
  </div>
</footer>

{#if viewingItem}
  <ViewCardModal item={viewingItem} onclose={closeViewModal} onedit={openEditFromView} />
{/if}

{#if activeModal}
  <AddEntryModal type={activeModal} editItem={editingItem} onclose={closeModal} ondelete={async (item) => { await deleteItem(item.id, item); closeModal(); }} />
{/if}

{#if showCollectionForm}
  <CollectionFormModal onclose={() => showCollectionForm = false} onsave={handleCreateCollection} groupId={route.page === 'group' ? route.groupId : undefined} />
{/if}

{#if showGroupForm}
  <GroupFormModal onclose={() => showGroupForm = false} onsave={handleCreateGroup} />
{/if}

<style>
  /* ── Accessibility ─────────────────────────── */
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

  /* ── Header shell ──────────────────────────── */
  header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    width: 100%;
  }

  .header-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem 1.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    justify-content: space-between;
  }

  /* ── Brand (zone 1) ────────────────────────── */
  .brand {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    flex-shrink: 0;
  }

  .brand-link {
    display: flex;
    align-items: center;
    color: inherit;
  }

  .brand-link:hover {
    color: inherit;
  }

  .brand-logo {
    height: 38px;
    width: auto;
  }

  /* ── Navigation (zone 2) ───────────────────── */
  .header-nav {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 0.3rem;
    padding: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--surface) 88%, black 12%);
    min-width: 0;
    flex-shrink: 1;
    overflow-x: auto;
    max-width: 100%;
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .header-nav::-webkit-scrollbar {
    display: none;
  }

  .header-nav a {
    display: inline-flex;
    align-items: center;
    min-height: 2rem;
    padding: 0 0.8rem;
    border-radius: 999px;
    color: var(--text-muted);
    font-size: 0.92rem;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 180ms ease, color 180ms ease;
  }

  .header-nav a:hover {
    color: var(--text);
  }

  .header-nav a.active {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 18%, var(--surface) 82%);
  }

  /* Group links — truncate long names */
  .header-nav .group-link {
    gap: 0.35rem;
    max-width: 10rem;
    flex-shrink: 1;
    min-width: 0;
  }

  .group-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-nav .group-link.active {
    background: color-mix(in srgb, var(--group-color) 18%, var(--surface) 82%);
  }

  .group-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--group-color);
    flex-shrink: 0;
  }

  .nav-add-group {
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
    opacity: 0.5;
  }

  .nav-add-group:hover {
    color: var(--accent);
    background: var(--accent-subtler);
    opacity: 1;
  }

  /* ── Connection controls (zone 3) ──────────── */
  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  /* ── Main content ──────────────────────────── */
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.5rem;
    width: 100%;
  }

  .content-layout {
    display: flex;
    gap: 1.5rem;
    align-items: flex-start;
  }

  .inbox-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .sidebar {
    width: 280px;
    flex-shrink: 0;
    position: sticky;
    top: 5rem;
  }

  .inbox-area {
    flex: 1;
    min-width: 0;
  }

  /* ── Mobile ────────────────────────────────── */
  @media (max-width: 768px) {
    .header-inner {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-rows: auto auto;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
    }

    /* Row 1, left: brand */
    .brand {
      grid-column: 1;
      grid-row: 1;
    }

    .brand-logo {
      height: 30px;
    }

    /* Row 1, right: connection controls */
    .header-right {
      grid-column: 2;
      grid-row: 1;
      align-items: flex-start;
      justify-content: flex-end;
    }

    /* Row 2, full width: navigation */
    .header-nav {
      grid-column: 1 / -1;
      grid-row: 2;
      border-radius: 0.75rem;
      gap: 0.25rem;
      padding: 0.2rem;
    }

    .header-nav a {
      min-height: 1.75rem;
      padding: 0 0.6rem;
      font-size: 0.82rem;
    }

    .header-nav .group-link {
      max-width: 7rem;
    }

    .content-layout {
      flex-direction: column;
    }

    .sidebar {
      width: 100%;
      position: static;
    }
  }

  /* ── App Footer ──────────────────────────── */
  .app-footer {
    border-top: 1px solid var(--border);
    margin-top: 2rem;
    padding: 1rem 1.5rem;
  }

  .app-footer-inner {
    max-width: 1200px;
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

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    text-align: center;
    gap: 0.75rem;
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: 0.5rem;
  }

  .empty-state h2 {
    font-size: 1.5rem;
    font-weight: 600;
  }

  .empty-state p {
    color: var(--text-muted);
    max-width: 400px;
  }
</style>
