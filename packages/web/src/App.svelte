<script lang="ts">
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';
  import type { InboxItemType, InboxItem, Collection, CollectionGroup } from '@inbox-rs/rs-module';
  // Value import (not `import type`): the bound ref below is typed via
  // `InstanceType<typeof UserMenu>`, and `typeof` needs the value binding.
  // biome-ignore lint/style/useImportType: typeof needs the runtime binding
  import UserMenu from './components/UserMenu.svelte';
  import InboxGrid from './components/InboxGrid.svelte';
  import AddEntryBar from './components/AddEntryBar.svelte';
  import MigrationAlert from './components/MigrationAlert.svelte';
  import ClassicShell from './components/ClassicShell.svelte';
  import {
    connected, deleteItem, openTodos, pendingMigrationCount, runAllMigrations,
    createCollection, storeGroup,
    appConfig, setActiveGroupFilters,
  } from './lib/stores';
  import { parseHash, formatRoute, pageUsesFilters, replaceRouteHash, type Page, type Route } from './lib/route';

  type LazyComponent = Component<Record<string, unknown>>;

  let activeModal = $state<InboxItemType | null>(null);
  let editingItem = $state<InboxItem | undefined>(undefined);
  let viewingItem = $state<InboxItem | null>(null);
  let showCollectionForm = $state(false);
  let showGroupForm = $state(false);
  let userMenu = $state<InstanceType<typeof UserMenu> | null>(null);
  let AddEntryModalComponent = $state<LazyComponent | null>(null);
  let ViewCardModalComponent = $state<LazyComponent | null>(null);
  let PluginsPageComponent = $state<LazyComponent | null>(null);
  let TodosPageComponent = $state<LazyComponent | null>(null);
  let CollectionsPageComponent = $state<LazyComponent | null>(null);
  let CollectionFormModalComponent = $state<LazyComponent | null>(null);
  let GroupFormModalComponent = $state<LazyComponent | null>(null);
  // Collection to pre-select when opening the add-entry modal. Used by the
  // per-row quick-add on the Todos page so the new todo lands in the same
  // collection as the row the user is adding alongside.
  let preselectedCollectionId = $state<string | undefined>(undefined);

  let route = $state<Route>(parseHash(window.location.hash));

  async function loadAddEntryModal() {
    AddEntryModalComponent ??= (await import('./components/AddEntryModal.svelte')).default as LazyComponent;
  }

  async function loadViewCardModal() {
    ViewCardModalComponent ??= (await import('./components/ViewCardModal.svelte')).default as LazyComponent;
  }

  async function loadPluginsPage() {
    PluginsPageComponent ??= (await import('./components/PluginsPage.svelte')).default as LazyComponent;
  }

  async function loadTodosPage() {
    TodosPageComponent ??= (await import('./components/TodosPage.svelte')).default as LazyComponent;
  }

  async function loadCollectionsPage() {
    CollectionsPageComponent ??= (await import('./components/CollectionsPage.svelte')).default as LazyComponent;
  }

  async function loadCollectionFormModal() {
    CollectionFormModalComponent ??= (await import('./components/CollectionFormModal.svelte')).default as LazyComponent;
  }

  async function loadGroupFormModal() {
    GroupFormModalComponent ??= (await import('./components/GroupFormModal.svelte')).default as LazyComponent;
  }

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
      replaceRouteHash(expected);
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

  $effect(() => {
    if (route.page === 'plugins') void loadPluginsPage();
  });

  $effect(() => {
    if (route.page === 'todos') void loadTodosPage();
  });

  $effect(() => {
    if (route.page === 'collections') void loadCollectionsPage();
  });

  $effect(() => {
    if (activeModal) void loadAddEntryModal();
  });

  $effect(() => {
    if (viewingItem) void loadViewCardModal();
  });

  $effect(() => {
    if (showCollectionForm) void loadCollectionFormModal();
  });

  $effect(() => {
    if (showGroupForm) void loadGroupFormModal();
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
      replaceRouteHash(hash);
      route = target;
    }
  }

  function openAdd(type: InboxItemType) {
    editingItem = undefined;
    preselectedCollectionId = undefined;
    activeModal = type;
    void loadAddEntryModal();
  }

  function openAddTodo() {
    openAdd('todo');
  }

  /** Open the add-todo modal with a specific collection pre-selected.
      Callers pass a real collection id to target that collection, or
      `undefined` to keep the new todo unfiled. */
  function openAddTodoInCollection(collectionId: string | undefined) {
    editingItem = undefined;
    preselectedCollectionId = collectionId;
    activeModal = 'todo';
    void loadAddEntryModal();
  }

  function openView(item: InboxItem) {
    viewingItem = item;
    void loadViewCardModal();
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

  function openConnectMenu() {
    void userMenu?.openConnectMenu();
  }

  async function handleCreateCollection(col: Collection) {
    try {
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

  function openGroupForm() {
    showGroupForm = true;
    void loadGroupFormModal();
  }

  // Surface a small badge with open todo count next to the Todos nav item.
  // Counts every open todo so the badge matches the flat Todos page.
  const openTodoCount = $derived($openTodos.length);
</script>

<ClassicShell {route} {navTo} {openTodoCount} onaddgroup={openGroupForm} bind:userMenu>
  {#if route.page === 'plugins'}
      {#if PluginsPageComponent}
        <PluginsPageComponent />
      {/if}
    {:else}
      {#if $pendingMigrationCount > 0}
        <MigrationAlert count={$pendingMigrationCount} onrun={runAllMigrations} />
      {/if}

      {#if route.page === 'inbox'}
        <div class="page-toolbar">
          <!-- Inbox is a refs-only staging area for unprocessed thoughts.
               Todos are captured from the dedicated Todos surface so they can
               be added quickly, then optionally filed into a collection later.
               Existing notes can still be converted via `makeTodo` when the
               user is ready to commit. -->
          <AddEntryBar onadd={openAdd} excludeTypes={['todo']} />
        </div>
        <InboxGrid onselect={openView} onconnect={openConnectMenu} />
      {:else if route.page === 'todos'}
        {#if TodosPageComponent}
          <TodosPageComponent onselect={openView} onaddtodo={openAddTodo} onaddtodoincollection={openAddTodoInCollection} />
        {/if}
      {:else}
        {#if CollectionsPageComponent}
          <CollectionsPageComponent onselect={openView} />
        {/if}
      {/if}
    {/if}
</ClassicShell>

{#if viewingItem}
  {#if ViewCardModalComponent}
    <ViewCardModalComponent item={viewingItem} onclose={closeViewModal} onedit={openEditFromView} />
  {/if}
{/if}

{#if activeModal}
  {#if AddEntryModalComponent}
    <AddEntryModalComponent
      type={activeModal}
      editItem={editingItem}
      collectionId={preselectedCollectionId}
      onclose={closeModal}
      ondelete={async (item: InboxItem) => { await deleteItem(item.id, item); closeModal(); }}
    />
  {/if}
{/if}

{#if showCollectionForm}
  {#if CollectionFormModalComponent}
    <CollectionFormModalComponent onclose={() => showCollectionForm = false} onsave={handleCreateCollection} />
  {/if}
{/if}

{#if showGroupForm}
  {#if GroupFormModalComponent}
    <GroupFormModalComponent onclose={() => showGroupForm = false} onsave={handleCreateGroup} />
  {/if}
{/if}

<style>
  /* Inbox add-entry toolbar — the only chrome that lives with the page
     content (rendered into the shell's main slot). All header/footer styling
     belongs to the shell component. */
  .page-toolbar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
</style>
