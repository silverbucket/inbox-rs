<script lang="ts">
  import { isMac } from '../lib/platform';

  let { active = false, onclick }: { active?: boolean; onclick: () => void } = $props();

  // The same two shortcuts App.svelte listens for; the tooltip is the only
  // place they are advertised, so keep it in step with the handler there.
  const shortcut = isMac() ? '⌘K or /' : 'Ctrl+K or /';
</script>

<button
  type="button"
  class="search-trigger"
  class:active
  aria-label="Search"
  aria-current={active ? 'page' : undefined}
  title="Search ({shortcut})"
  {onclick}
>
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
</button>

<style>
  /* Sized and shaped like the UserMenu trigger it sits beside. */
  .search-trigger {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
    transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
  }

  .search-trigger:hover {
    border-color: var(--accent);
    background: var(--accent-subtler);
    color: var(--text);
  }

  .search-trigger.active {
    border-color: var(--accent);
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .search-trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
