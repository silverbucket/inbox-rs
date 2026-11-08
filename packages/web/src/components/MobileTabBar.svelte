<script lang="ts">
  /**
   * Phone navigation: a bottom tab bar with Inbox, Today, Plan and
   * Collections around a central Capture button. Today and Plan are both
   * the Todos page — they just pick its view (Today, or the Horizon plan).
   * Shown at ≤600px only; the header nav pills hide at the same width.
   */
  import type { Page } from '../lib/route';
  import { appConfig, sortedItems, updateConfig } from '../lib/stores';
  import { showToast } from '../lib/toast';

  let {
    page,
    planCount,
    navTo,
    oncapture,
  }: {
    page: Page;
    planCount: number;
    navTo: (page: Page) => void;
    oncapture: () => void;
  } = $props();

  // Phones default the Todos page to Today (see TodosPage).
  const todosView = $derived($appConfig.todosView ?? 'today');
  const onToday = $derived(page === 'todos' && todosView === 'today');
  const onPlan = $derived(page === 'todos' && todosView === 'horizon');
  const inboxCount = $derived($sortedItems.length);

  async function openTodos(view: 'today' | 'horizon') {
    navTo('todos');
    if (todosView === view) return;
    try {
      await updateConfig({ todosView: view });
    } catch (error) {
      console.error('Failed to switch Todos view', error);
      showToast(`Couldn’t switch to ${view === 'today' ? 'Today' : 'Plan'}`);
    }
  }
</script>

<div class="tabbar-spacer" aria-hidden="true"></div>
<nav class="tabbar" aria-label="Primary (mobile)">
  <button
    type="button"
    class="tab"
    class:active={page === 'inbox'}
    aria-current={page === 'inbox' ? 'page' : undefined}
    onclick={() => navTo('inbox')}
  >
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"></path><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>
    <span class="label">Inbox</span>
    {#if inboxCount > 0}<span class="count">{inboxCount}</span>{/if}
  </button>
  <button
    type="button"
    class="tab"
    class:active={onToday}
    aria-current={onToday ? 'page' : undefined}
    onclick={() => openTodos('today')}
  >
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>
    <span class="label">Today</span>
  </button>
  <button type="button" class="capture" aria-label={page === 'todos' ? 'New todo' : page === 'collections' ? 'New collection' : 'Capture'} title={page === 'todos' ? 'New todo' : page === 'collections' ? 'New collection' : 'Capture'} onclick={oncapture}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>
  </button>
  <button
    type="button"
    class="tab"
    class:active={onPlan}
    aria-current={onPlan ? 'page' : undefined}
    onclick={() => openTodos('horizon')}
  >
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h6"></path></svg>
    <span class="label">Plan</span>
    {#if planCount > 0}<span class="count">{planCount}</span>{/if}
  </button>
  <button
    type="button"
    class="tab"
    class:active={page === 'collections'}
    aria-current={page === 'collections' ? 'page' : undefined}
    onclick={() => navTo('collections')}
  >
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>
    <span class="label">Collections</span>
  </button>
</nav>

<style>
  .tabbar,
  .tabbar-spacer {
    display: none;
  }

  @media (max-width: 600px) {
    .tabbar-spacer {
      display: block;
      height: calc(4.25rem + env(safe-area-inset-bottom, 0px));
    }

    .tabbar {
      position: fixed;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 120;
      display: grid;
      grid-template-columns: repeat(2, 1fr) auto repeat(2, 1fr);
      align-items: center;
      gap: 0.15rem;
      padding: 0.3rem 0.4rem calc(0.3rem + env(safe-area-inset-bottom, 0px));
      border-top: 1px solid var(--border);
      background: var(--surface);
      box-shadow: 0 -6px 20px var(--shadow);
    }
  }

  .tab {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    min-width: 0;
    min-height: 3.1rem;
    padding: 0.3rem 0.2rem;
    border: 0;
    border-radius: 1rem;
    background: none;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .tab svg {
    width: 1.35rem;
    height: 1.35rem;
  }

  .label {
    max-width: 100%;
    overflow: hidden;
    font-size: 0.68rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab.active {
    color: var(--accent-text);
    background: var(--accent-subtler);
  }

  .count {
    position: absolute;
    top: 0.1rem;
    left: calc(50% + 0.45rem);
    min-width: 1.1rem;
    padding: 0 0.3rem;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 0.62rem;
    font-weight: 700;
    line-height: 1.1rem;
    text-align: center;
  }

  .capture {
    display: grid;
    place-items: center;
    width: 3.25rem;
    height: 3.25rem;
    margin: -1.3rem 0.35rem 0;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    box-shadow: 0 6px 16px var(--shadow);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .capture svg {
    width: 1.5rem;
    height: 1.5rem;
  }
</style>
