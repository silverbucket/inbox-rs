<script lang="ts">
  import { onMount } from 'svelte';
  import type { InboxItemType, InboxItem, Collection, CollectionGroup } from '@inbox-rs/rs-module';
  import UserMenu from './components/UserMenu.svelte';
  import InboxGrid from './components/InboxGrid.svelte';
  import AddEntryBar from './components/AddEntryBar.svelte';
  import AddEntryModal from './components/AddEntryModal.svelte';
  import ViewCardModal from './components/ViewCardModal.svelte';
  import MigrationAlert from './components/MigrationAlert.svelte';
  import PluginsPage from './components/PluginsPage.svelte';
  import CollectionsPage from './components/CollectionsPage.svelte';
  import TodosPage from './components/TodosPage.svelte';
  import GroupFilterBar from './components/GroupFilterBar.svelte';
  import CollectionFormModal from './components/CollectionFormModal.svelte';
  import GroupFormModal from './components/GroupFormModal.svelte';
  import {
    connected, deleteItem, openTodos, pendingMigrationCount, runAllMigrations,
    createCollection, storeGroup,
    appConfig, setActiveGroupFilters,
  } from './lib/stores';
  import { parseHash, formatRoute, pageUsesFilters, type Page, type Route } from './lib/route';
  import { pluginArtifactVersion } from './lib/plugin-downloads.generated';
  import LogoShield from './components/LogoShield.svelte';

  let activeModal = $state<InboxItemType | null>(null);
  let editingItem = $state<InboxItem | undefined>(undefined);
  let viewingItem = $state<InboxItem | null>(null);
  let showCollectionForm = $state(false);
  let showGroupForm = $state(false);
  // Collection to pre-select when opening the add-entry modal. Used by the
  // per-row quick-add on the Todos page so the new todo lands in the same
  // collection as the row the user is adding alongside.
  let preselectedCollectionId = $state<string | undefined>(undefined);

  let route = $state<Route>(parseHash(window.location.hash));

  // ---- Route ↔ filter sync ----
  // Source of truth for filters is `appConfig.activeGroupFilters`. URL params
  // are an optional override applied once on load (or when the URL changes).
  let lastAppliedFilterHash = $state<string | undefined>(undefined);
  $effect(() => {
    if (!pageUsesFilters(route.page)) return;
    const filters = route.groupFilters;
    if (filters === undefined) return;
    const key = `${route.page}::${filters.join(',')}`;
    if (lastAppliedFilterHash === key) return;
    lastAppliedFilterHash = key;
    void setActiveGroupFilters(filters).catch(e => {
      console.error('Failed to sync URL filters to config', e);
    });
  });

  // When user toggles filter pills, reflect into URL (without history spam).
  $effect(() => {
    if (!pageUsesFilters(route.page)) return;
    const config = $appConfig;
    if (config.activeGroupFilters === undefined) return; // default-all → no param
    const expected = formatRoute({ page: route.page, groupFilters: config.activeGroupFilters });
    if (window.location.hash !== expected) {
      window.history.replaceState(null, '', expected);
      route = { page: route.page, groupFilters: config.activeGroupFilters };
      lastAppliedFilterHash = `${route.page}::${config.activeGroupFilters.join(',')}`;
    }
  });

  onMount(() => {
    const syncRoute = () => {
      route = parseHash(window.location.hash);
    };
    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  });

  // Close modals when navigating
  $effect(() => {
    void route.page;
    activeModal = null;
    editingItem = undefined;
    viewingItem = null;
  });

  // Lock body scroll when any modal is open (including iOS Safari)
  const anyModalOpen = $derived(!!viewingItem || !!activeModal || showCollectionForm || showGroupForm);
  let savedScrollY = 0;
  let wasModalOpen = false;

  $effect(() => {
    if (anyModalOpen && !wasModalOpen) {
      savedScrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';
    } else if (!anyModalOpen && wasModalOpen) {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.overflow = '';
      window.scrollTo(0, savedScrollY);
    }
    wasModalOpen = anyModalOpen;
  });

  function navTo(page: Page) {
    const target: Route = pageUsesFilters(page) && $appConfig.activeGroupFilters !== undefined
      ? { page, groupFilters: $appConfig.activeGroupFilters }
      : { page };
    const hash = formatRoute(target);
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
  }

  function isActive(page: Page): boolean {
    return route.page === page;
  }

  function openAdd(type: InboxItemType) {
    editingItem = undefined;
    preselectedCollectionId = undefined;
    activeModal = type;
  }

  function openAddTodo() {
    openAdd('todo');
  }

  /** Open the add-todo modal with a specific collection pre-selected.
      `undefined` means "Uncategorized" — matching the picker's own default. */
  function openAddTodoInCollection(collectionId: string | undefined) {
    editingItem = undefined;
    preselectedCollectionId = collectionId;
    activeModal = 'todo';
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
    preselectedCollectionId = undefined;
  }

  async function handleCreateCollection(col: Collection) {
    try {
      // createCollection guarantees the collection ends up inside a group —
      // either the one the form picked, or a fresh "UncategorizedN" group.
      await createCollection(col);
      showCollectionForm = false;
    } catch (error) {
      console.error('Failed to create collection', error);
    }
  }

  async function handleCreateGroup(group: CollectionGroup) {
    try {
      await storeGroup(group);
      showGroupForm = false;
    } catch (error) {
      console.error('Failed to create group', error);
    }
  }

  // Surface a small badge with open todo count next to the Todos nav item.
  // Counts every open todo across all collections (not just uncategorized) so
  // the badge matches what the user sees on the flat Todos page.
  const openTodoCount = $derived($openTodos.length);
</script>

<header>
  <div class="header-inner">
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
      <UserMenu />
    </div>
  </div>
  {#if $connected && route.page !== 'plugins'}
    <div class="header-filters">
      <div class="header-filters-inner">
        <GroupFilterBar
          onaddgroup={() => showGroupForm = true}
          dimmed={!pageUsesFilters(route.page)}
        />
      </div>
    </div>
  {/if}
</header>

<main>
  {#if route.page === 'plugins'}
    <PluginsPage />
  {:else if !$connected}
    <div class="empty-state">
      <div class="empty-icon">📥</div>
      <h2>Connect your storage</h2>
      <p>Enter your remoteStorage address above to view your inbox.</p>
    </div>
  {:else}
    {#if $pendingMigrationCount > 0}
      <MigrationAlert count={$pendingMigrationCount} onrun={runAllMigrations} />
    {/if}

    {#if route.page === 'inbox'}
      <div class="page-toolbar">
        <!-- Inbox is a refs-only staging area for unprocessed thoughts.
             Todos always need a home (a collection), so adding one straight
             to the Inbox would silently land it in the dynamic Uncategorized
             bucket — which mixes "I haven't decided what this is" notes with
             "I committed to doing this" todos. Hide the Todo button here so
             the only way to create a todo is from a collection or the Todos
             page picker, both of which force a collection choice. Existing
             notes can still be converted via `makeTodo` when the user is
             ready to commit. -->
        <AddEntryBar onadd={openAdd} excludeTypes={['todo']} />
      </div>
      <InboxGrid onselect={openView} />
    {:else if route.page === 'todos'}
      <TodosPage onselect={openView} onaddtodo={openAddTodo} onaddtodoincollection={openAddTodoInCollection} />
    {:else}
      <CollectionsPage onselect={openView} />
    {/if}
  {/if}
</main>

<footer class="app-footer">
  <div class="app-footer-inner">
    <span class="footer-brand">Inbox RS</span>
    <span class="footer-version">v{pluginArtifactVersion}</span>
    <span class="footer-sep">·</span>
    <a class="footer-link" class:active={isActive('plugins')} href="#/plugins">
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
  <AddEntryModal
    type={activeModal}
    editItem={editingItem}
    collectionId={preselectedCollectionId}
    onclose={closeModal}
    ondelete={async (item) => { await deleteItem(item.id, item); closeModal(); }}
  />
{/if}

{#if showCollectionForm}
  <CollectionFormModal onclose={() => showCollectionForm = false} onsave={handleCreateCollection} />
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
  }

  /* ── Brand ─────────────────────────────────── */
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
    display: inline-flex;
    height: 38px;
    width: auto;
  }

  .brand-logo :global(svg) {
    height: 38px;
    width: auto;
  }

  /* ── Primary nav (Inbox / Todos / Collections) ── */
  .header-nav {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--surface) 88%, black 12%);
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

  /* ── Connection controls ─────────────────── */
  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
    margin-left: auto;
  }

  /* ── Filter bar (group toggles) ──────────── */
  .header-filters {
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 60%, var(--bg) 40%);
  }

  .header-filters-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0.4rem 1.5rem;
  }

  /* ── Main content ──────────────────────────── */
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.5rem;
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .page-toolbar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    flex-wrap: wrap;
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

    .brand {
      grid-column: 1;
      grid-row: 1;
    }

    .brand-logo {
      height: 30px;
    }

    .brand-logo :global(svg) {
      height: 30px;
      width: auto;
    }

    .header-right {
      grid-column: 2;
      grid-row: 1;
      align-items: flex-start;
      justify-content: flex-end;
    }

    .header-nav {
      grid-column: 1 / -1;
      grid-row: 2;
      border-radius: 0.75rem;
      gap: 0.25rem;
      padding: 0.2rem;
      justify-content: center;
    }

    .header-nav button {
      min-height: 1.75rem;
      padding: 0 0.7rem;
      font-size: 0.82rem;
    }

    .header-filters-inner {
      padding: 0.4rem 1rem;
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
