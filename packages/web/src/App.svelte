<script lang="ts">
  import type { InboxItemType, InboxItem } from '@inbox-rs/rs-module';
  import ConnectWidget from './components/ConnectWidget.svelte';
  import InboxGrid from './components/InboxGrid.svelte';
  import TodoList from './components/TodoList.svelte';
  import AddEntryBar from './components/AddEntryBar.svelte';
  import AddEntryModal from './components/AddEntryModal.svelte';
  import ViewCardModal from './components/ViewCardModal.svelte';
  import MigrationAlert from './components/MigrationAlert.svelte';
  import { connected, deleteItem, todoItems, appConfig, updateConfig, pendingMigrations, runAllMigrations } from './lib/stores';


  let activeModal = $state<InboxItemType | null>(null);
  let editingItem = $state<InboxItem | undefined>(undefined);
  let viewingItem = $state<InboxItem | null>(null);
  let todosExpanded = $state(false);
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
    <h1>Inbox <span class="accent">RS</span></h1>
    <ConnectWidget />
  </div>
</header>

<main>
  {#if $pendingMigrations.length > 0}
    <MigrationAlert migrations={$pendingMigrations} onrun={runAllMigrations} />
  {/if}

  {#if $connected}
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
    justify-content: space-between;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.02em;
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
