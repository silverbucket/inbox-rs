<script lang="ts">
  import type { Snippet } from 'svelte';
  import UserMenu from './UserMenu.svelte';
  import GroupFilterBar from './GroupFilterBar.svelte';
  import LogoShield from './LogoShield.svelte';
  import { pageUsesFilters, type Page, type Route } from '../lib/route';
  import AppFooter from './AppFooter.svelte';

  // bind:this on a Svelte 5 component yields its exports, not a class instance.
  type UserMenuHandle = { openConnectMenu: () => Promise<void> };

  let {
    route,
    navTo,
    viewTodoCount,
    totalTodoCount,
    onaddgroup,
    onopensettings = () => {},
    userMenu = $bindable(null),
    children,
  }: {
    route: Route;
    navTo: (page: Page) => void;
    /** Open todos within the current group/collection focus (primary badge). */
    viewTodoCount: number;
    /** Total incomplete todos everywhere (greyed secondary badge). */
    totalTodoCount: number;
    onaddgroup: () => void;
    onopensettings?: (section?: import('../lib/settings-sections').SectionId) => void;
    userMenu?: UserMenuHandle | null;
    children: Snippet;
  } = $props();

  function isActive(page: Page): boolean {
    // Focus mode is a Collections sub-page; keep that tab lit so the user
    // knows which section they're in.
    if (page === 'collections' && route.page === 'collection') return true;
    return route.page === page;
  }
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
        {#if viewTodoCount > 0}
          <span class="nav-badge">{viewTodoCount}</span>
        {/if}
        {#if totalTodoCount > viewTodoCount}
          <span class="nav-badge-total" title="{totalTodoCount} incomplete todos in total">{totalTodoCount}</span>
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
      <UserMenu bind:this={userMenu} {onopensettings} />
    </div>
  </div>
  {#if route.page !== 'plugins'}
    <div class="header-filters">
      <div class="header-filters-inner">
        <GroupFilterBar
          {onaddgroup}
          dimmed={!pageUsesFilters(route.page)}
        />
      </div>
    </div>
  {/if}
</header>

<main>
  {@render children()}
</main>

<footer class="app-footer">
  <AppFooter pluginsActive={isActive('plugins')} centered />
</footer>

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
    /* Scrolls with the page. Positioned only so its menus stack above the
       content below. */
    position: relative;
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
    /* Faint accent tint rather than a flat grey, so the rail harmonises with
       the active theme instead of clashing with it. */
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

  /* Greyed total-incomplete count, shown after the accent pill when the
     current view hides some todos. Muted so it reads as secondary. */
  .nav-badge-total {
    font-size: 0.62rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-left: 3px;
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
    margin-top: 2rem;
  }
</style>
