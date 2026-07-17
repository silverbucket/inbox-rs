<script lang="ts">
  import type { Snippet } from 'svelte';
  import UserMenu from './UserMenu.svelte';
  import GroupFilterBar from './GroupFilterBar.svelte';
  import LogoShield from './LogoShield.svelte';
  import { pageUsesFilters, type Page, type Route } from '../lib/route';
  import { appVersion } from '../lib/plugin-downloads.generated';

  // bind:this on a Svelte 5 component yields its exports, not a class instance.
  type UserMenuHandle = { openConnectMenu: () => Promise<void> };

  let {
    route,
    navTo,
    focusedTodoCount,
    onaddgroup,
    userMenu = $bindable(null),
    children,
  }: {
    route: Route;
    navTo: (page: Page) => void;
    focusedTodoCount: number;
    onaddgroup: () => void;
    userMenu?: UserMenuHandle | null;
    children: Snippet;
  } = $props();

  function isActive(page: Page): boolean {
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
        {#if focusedTodoCount > 0}
          <span
            class="nav-badge"
            title="{focusedTodoCount} focused {focusedTodoCount === 1 ? 'todo' : 'todos'}"
          >{focusedTodoCount}</span>
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
</style>
