<script lang="ts">
  import type { InboxItemType, InboxItem } from '@inbox-rs/rs-module';
  import ConnectWidget from './components/ConnectWidget.svelte';
  import InboxGrid from './components/InboxGrid.svelte';
  import TodoList from './components/TodoList.svelte';
  import AddEntryBar from './components/AddEntryBar.svelte';
  import AddEntryModal from './components/AddEntryModal.svelte';
  import { connected } from './lib/stores';

  let activeModal = $state<InboxItemType | null>(null);
  let editingItem = $state<InboxItem | undefined>(undefined);

  function openAdd(type: InboxItemType) {
    editingItem = undefined;
    activeModal = type;
  }

  function openEdit(item: InboxItem) {
    editingItem = item;
    activeModal = item.type;
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
  {#if $connected}
    <AddEntryBar onadd={openAdd} />
    <div class="content-layout">
      <aside class="sidebar">
        <TodoList onedit={openEdit} />
      </aside>
      <div class="inbox-area">
        <InboxGrid onedit={openEdit} />
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

{#if activeModal}
  <AddEntryModal type={activeModal} editItem={editingItem} onclose={closeModal} />
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
    margin-top: 1rem;
  }

  .sidebar {
    width: 260px;
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
