<script lang="ts">
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';
  import type { InboxItemType, InboxItem, Collection, CollectionGroup } from '@inbox-rs/rs-module';
  import InboxGrid from './components/InboxGrid.svelte';
  import MigrationAlert from './components/MigrationAlert.svelte';
  import ClassicShell from './components/ClassicShell.svelte';
  import SidebarShell from './components/SidebarShell.svelte';
  import CaptureBar from './components/CaptureBar.svelte';
  import CaptureSheet from './components/CaptureSheet.svelte';
  import Toast from './components/Toast.svelte';
  import {
    connected, deleteItem, openTodos, pendingMigrationCount, runAllMigrations,
    createCollection, storeGroup,
    appConfig, setActiveGroupFilters,
  } from './lib/stores';
  import { captureDetected, captureFile } from './lib/capture';
  import { loadLazy } from './lib/lazy-load';
  import { showToast } from './lib/toast';
  import { parseHash, formatRoute, pageUsesFilters, type Page, type Route } from './lib/route';
  import { layout } from './lib/layout';

  type LazyComponent = Component<Record<string, unknown>>;
  // Svelte 5 components are functions, not classes — InstanceType<> doesn't
  // apply. bind:this yields the component's exports, so type the handle.
  type UserMenuHandle = { openConnectMenu: () => Promise<void> };

  let activeModal = $state<InboxItemType | null>(null);
  let editingItem = $state<InboxItem | undefined>(undefined);
  let viewingItem = $state<InboxItem | null>(null);
  let showCollectionForm = $state(false);
  let showGroupForm = $state(false);
  let userMenu = $state<UserMenuHandle | null>(null);
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

  let captureSheetOpen = $state(false);
  let notePrefillTitle = $state('');
  let prefillFile = $state<File | undefined>(undefined);
  let isTouch = $state(
    typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches,
  );
  // Highlights the inbox feed while a file is dragged over it (desktop only).
  let feedDragOver = $state(false);

  $effect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 600px)');
    isTouch = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      isTouch = e.matches;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  let route = $state<Route>(parseHash(window.location.hash));

  // A failed lazy load must never leave a modal "open" with no UI — the
  // onerror callbacks undo the state that summoned it (see lib/lazy-load.ts).
  async function loadAddEntryModal() {
    AddEntryModalComponent ??= await loadLazy<LazyComponent>(
      () => import('./components/AddEntryModal.svelte'),
      closeModal,
    );
  }

  async function loadViewCardModal() {
    ViewCardModalComponent ??= await loadLazy<LazyComponent>(
      () => import('./components/ViewCardModal.svelte'),
      () => { viewingItem = null; },
    );
  }

  async function loadPluginsPage() {
    PluginsPageComponent ??= await loadLazy<LazyComponent>(() => import('./components/PluginsPage.svelte'));
  }

  async function loadTodosPage() {
    TodosPageComponent ??= await loadLazy<LazyComponent>(() => import('./components/TodosPage.svelte'));
  }

  async function loadCollectionsPage() {
    CollectionsPageComponent ??= await loadLazy<LazyComponent>(() => import('./components/CollectionsPage.svelte'));
  }

  async function loadCollectionFormModal() {
    CollectionFormModalComponent ??= await loadLazy<LazyComponent>(
      () => import('./components/CollectionFormModal.svelte'),
      () => { showCollectionForm = false; },
    );
  }

  async function loadGroupFormModal() {
    GroupFormModalComponent ??= await loadLazy<LazyComponent>(
      () => import('./components/GroupFormModal.svelte'),
      () => { showGroupForm = false; },
    );
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

  // Lock body scroll when any modal is open (including iOS Safari). Each
  // lazy-loaded modal counts only once its component is available — the same
  // condition that renders it — so the lock can never engage for a modal that
  // isn't on screen (e.g. its chunk failed to load).
  const anyModalOpen = $derived(
    !!(viewingItem && ViewCardModalComponent)
    || !!(activeModal && AddEntryModalComponent)
    || (showCollectionForm && !!CollectionFormModalComponent)
    || (showGroupForm && !!GroupFormModalComponent)
    || captureSheetOpen,
  );
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

  function openAdd(type: InboxItemType) {
    editingItem = undefined;
    preselectedCollectionId = undefined;
    notePrefillTitle = '';
    prefillFile = undefined;
    captureSheetOpen = false;
    activeModal = type;
    void loadAddEntryModal();
  }

  async function handleQuickCapture(raw: string) {
    const res = await captureDetected(raw);
    if (!res) return;
    const label = res.item.type === 'bookmark' ? 'Saved bookmark' : 'Saved note';
    showToast(label, {
      label: 'Undo',
      // Surface a failure rather than silently leaving the item if the delete
      // rejects (e.g. transient storage error).
      run: () => {
        void deleteItem(res.item.id, res.item).catch(() => {
          showToast("Couldn't undo — open the item to remove it.");
        });
      },
    });
  }

  // Drop/paste onto the bar or inbox feed: store the file directly (no form),
  // mirroring the text quick-capture Undo. `deleteItem` removes the file and
  // thumbnail bytes too, so Undo leaves nothing orphaned.
  async function handleFileCapture(file: File, caption = '') {
    const res = await captureFile(file, caption);
    if (!res) return;
    const label = res.item.type === 'image' ? 'Saved image' : 'Saved file';
    showToast(label, {
      label: 'Undo',
      run: () => {
        void deleteItem(res.item.id, res.item).catch(() => {
          showToast("Couldn't undo — open the item to remove it.");
        });
      },
    });
  }

  // A multi-file drop captures only the first; tell the user the rest were
  // skipped so nothing is silently dropped.
  function notifyExtraFiles(ignored: number) {
    showToast(
      `Captured the first file — ignored ${ignored} other${ignored === 1 ? '' : 's'}.`,
    );
  }

  function handleFeedDrop(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    void handleFileCapture(files[0]);
    if (files.length > 1) notifyExtraFiles(files.length - 1);
  }

  function handleOpenEditor(text: string) {
    editingItem = undefined;
    preselectedCollectionId = undefined;
    prefillFile = undefined;
    captureSheetOpen = false;
    // The typed text becomes the note title; the editor focuses the body.
    notePrefillTitle = text;
    activeModal = 'note';
    void loadAddEntryModal();
  }

  // The ⊕ file picker routes by the chosen file's type: images open the image
  // modal, everything else the document modal — with the file pre-attached.
  function handleFile(file: File) {
    editingItem = undefined;
    preselectedCollectionId = undefined;
    notePrefillTitle = '';
    prefillFile = file;
    captureSheetOpen = false;
    activeModal = file.type.startsWith('image/') ? 'image' : 'document';
    void loadAddEntryModal();
  }

  function handleRecord() {
    openAdd('audio');
  }

  /** Open the add-todo modal, optionally pre-filling the title and target
      collection (⌘/Ctrl-Enter or the Fab from the Todos quick-add, so the
      modal mirrors the quick-add's title + collection selection). */
  function openAddTodo(prefillTitle = '', collectionId: string | undefined = undefined) {
    editingItem = undefined;
    preselectedCollectionId = collectionId;
    prefillFile = undefined;
    captureSheetOpen = false;
    notePrefillTitle = prefillTitle;
    activeModal = 'todo';
    void loadAddEntryModal();
  }

  /** Open the add-todo modal with a specific collection pre-selected.
      Callers pass a real collection id to target that collection, or
      `undefined` to keep the new todo unfiled. */
  function openAddTodoInCollection(collectionId: string | undefined) {
    editingItem = undefined;
    preselectedCollectionId = collectionId;
    prefillFile = undefined;
    captureSheetOpen = false;
    notePrefillTitle = '';
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
    notePrefillTitle = '';
    prefillFile = undefined;
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

{#snippet shellBody()}
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
          {#if isTouch}
            <button class="capture-trigger" type="button" onclick={() => (captureSheetOpen = true)}>
              Paste a link, jot a note, or drop a file…
            </button>
          {:else}
            <CaptureBar
              focusOnMount
              oncapture={handleQuickCapture}
              onopeneditor={handleOpenEditor}
              onfile={handleFile}
              onfilecapture={handleFileCapture}
              onextrafiles={notifyExtraFiles}
              onrecord={handleRecord}
            />
          {/if}
        </div>
        {#if isTouch}
          <InboxGrid onselect={openView} onconnect={openConnectMenu} />
        {:else}
          <!-- Desktop: dropping a file anywhere on the feed captures it
               directly (the bar handles its own drops separately). -->
          <div
            class="feed-dropzone"
            class:drag-over={feedDragOver}
            role="group"
            ondragover={(e) => {
              if (!e.dataTransfer?.types.includes('Files')) return;
              e.preventDefault();
              feedDragOver = true;
            }}
            ondragleave={(e) => {
              // Ignore leaves onto child cards so the highlight doesn't flicker.
              if ((e.currentTarget as Node).contains(e.relatedTarget as Node | null)) return;
              feedDragOver = false;
            }}
            ondrop={(e) => {
              feedDragOver = false;
              handleFeedDrop(e);
            }}
          >
            <InboxGrid onselect={openView} onconnect={openConnectMenu} />
          </div>
        {/if}
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
{/snippet}

{#if $layout === 'sidebar'}
  <SidebarShell {route} {navTo} {openTodoCount} onaddgroup={openGroupForm} bind:userMenu>
    {#snippet children()}{@render shellBody()}{/snippet}
  </SidebarShell>
{:else}
  <ClassicShell {route} {navTo} {openTodoCount} onaddgroup={openGroupForm} bind:userMenu>
    {#snippet children()}{@render shellBody()}{/snippet}
  </ClassicShell>
{/if}

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
      prefillTitle={notePrefillTitle}
      {prefillFile}
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

{#if captureSheetOpen}
  <CaptureSheet
    oncapture={handleQuickCapture}
    onfile={handleFile}
    onrecord={handleRecord}
    onclose={() => (captureSheetOpen = false)}
  />
{/if}
<Toast />

<style>
  /* Inbox add-entry toolbar — the only chrome that lives with the page
     content (rendered into the shell's main slot). All header/footer styling
     belongs to the shell component. */
  /* Wraps the inbox feed so a file dragged anywhere over it can be dropped.
     A dashed accent outline appears on drag-over; no layout shift (the
     outline draws outside the box). */
  .feed-dropzone {
    border-radius: 0.85rem;
    outline: 2px dashed transparent;
    outline-offset: 4px;
    transition: outline-color 0.12s ease;
  }
  .feed-dropzone.drag-over {
    outline-color: var(--accent);
  }

  .page-toolbar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .capture-trigger {
    display: block;
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.85rem;
    padding: 0.6rem 0.9rem;
    text-align: left;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
  }
</style>
