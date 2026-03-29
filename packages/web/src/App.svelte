<script lang="ts">
  import { onMount } from 'svelte';
  import type { InboxItemType, InboxItem } from '@inbox-rs/rs-module';
  import ConnectWidget from './components/ConnectWidget.svelte';
  import InboxGrid from './components/InboxGrid.svelte';
  import TodoList from './components/TodoList.svelte';
  import AddEntryBar from './components/AddEntryBar.svelte';
  import AddEntryModal from './components/AddEntryModal.svelte';
  import ViewCardModal from './components/ViewCardModal.svelte';
  import MigrationAlert from './components/MigrationAlert.svelte';
  import PluginsPage from './components/PluginsPage.svelte';
  import { connected, deleteItem, todoItems, appConfig, updateConfig, pendingMigrationCount, runAllMigrations } from './lib/stores';

  type Route = 'home' | 'plugins';

  let activeModal = $state<InboxItemType | null>(null);
  let editingItem = $state<InboxItem | undefined>(undefined);
  let viewingItem = $state<InboxItem | null>(null);
  let todosExpanded = $state(false);

  function getRouteFromHash(): Route {
    if (typeof window === 'undefined') return 'home';
    return window.location.hash === '#/plugins' ? 'plugins' : 'home';
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
    if (route !== 'plugins') return;
    activeModal = null;
    editingItem = undefined;
    viewingItem = null;
  });

  function handleTodoExpandChange(v: boolean) {
    userToggledTodos = true;
    todosExpanded = v;
    void updateConfig({ todosCollapsed: !v });
  }

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
</script>

<header>
  <div class="header-inner">
    <div class="header-left">
      <a class="brand-link" href="#/">
        <h1>Inbox <span class="accent">RS</span></h1>
      </a>
      <nav class="header-nav" aria-label="Primary">
        <a class:active={route === 'home'} aria-current={route === 'home' ? 'page' : undefined} href="#/">Inbox</a>
        <a class:active={route === 'plugins'} aria-current={route === 'plugins' ? 'page' : undefined} href="#/plugins">Plugins</a>
      </nav>
    </div>
    <ConnectWidget />
  </div>
</header>

<main>
  {#if route === 'plugins'}
    <PluginsPage />
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

{#if viewingItem}
  <ViewCardModal item={viewingItem} onclose={closeViewModal} onedit={openEditFromView} />
{/if}

{#if activeModal}
  <AddEntryModal type={activeModal} editItem={editingItem} onclose={closeModal} ondelete={async (item) => { await deleteItem(item.id, item); closeModal(); }} />
{/if}

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    backdrop-filter: blur(12px);
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

  .header-left {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-width: 0;
  }

  .brand-link {
    color: inherit;
  }

  .brand-link:hover {
    color: inherit;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .header-nav {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 88%, black 12%);
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
    transition: background 180ms ease, color 180ms ease;
  }

  .header-nav a:hover {
    color: var(--text);
  }

  .header-nav a.active {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 18%, var(--surface) 82%);
  }

  .accent {
    color: var(--accent);
  }

  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.5rem;
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

  @media (max-width: 768px) {
    .header-inner,
    .header-left {
      align-items: flex-start;
      flex-direction: column;
    }

    .header-nav {
      width: 100%;
      justify-content: space-between;
    }

    .content-layout {
      flex-direction: column;
    }

    .sidebar {
      width: 100%;
      position: static;
    }
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
