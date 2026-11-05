<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { CollectionGroup } from '@inbox-rs/rs-module';

  let {
    group,
    onedit,
    onaddcollection = undefined,
    collapsed = false,
    ontogglecollapse = undefined,
    peek = '',
    count = undefined,
    onboard = undefined,
    children,
  }: {
    group: CollectionGroup;
    /** Omit to hide the edit button. */
    onedit?: () => void;
    onaddcollection?: () => void;
    /** Folded to its header (with `peek` naming what's inside). */
    collapsed?: boolean;
    /** Omit to make the group unfoldable. */
    ontogglecollapse?: () => void;
    peek?: string;
    count?: number;
    /** Open the group's board; omit when no collection in it has one. */
    onboard?: () => void;
    children: Snippet;
  } = $props();
</script>

<section class="group-section" style="--group-color: {group.color || 'var(--accent)'}">
  <header class="group-header">
    {#if ontogglecollapse}
      <button
        type="button"
        class="btn-fold"
        aria-expanded={!collapsed}
        aria-label="{collapsed ? 'Expand' : 'Collapse'} group {group.name}"
        onclick={ontogglecollapse}
      >
        <svg aria-hidden="true" class="fold" class:open={!collapsed} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </button>
    {/if}
    <span class="group-swatch"></span>
    <h2 class="group-name">{group.name}</h2>
    {#if count !== undefined}<span class="group-count">{count} {count === 1 ? 'collection' : 'collections'}</span>{/if}
    {#if collapsed && peek}<span class="group-peek">{peek}</span>{/if}
    <span class="header-spacer"></span>
    {#if onboard}
      <button type="button" class="btn-board" onclick={onboard} title="Open {group.name} as one board">
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="5" height="16" rx="1"></rect><rect x="10" y="4" width="5" height="11" rx="1"></rect><rect x="17" y="4" width="4" height="7" rx="1"></rect></svg>
        Board
      </button>
    {/if}
    <div class="group-actions">
      <!--
        The add-collection button mirrors the per-row quick-add in TodoRow:
        tinted circular pill keyed off the group's colour so the primary
        "add" action carries the same visual vocabulary across Todos and
        Collections pages. The pencil beside it is a secondary affordance
        and keeps the muted flat style intentionally — we want the "+" to
        read louder than "edit".
      -->
      {#if onaddcollection}
        <button type="button" class="btn-add-collection" onclick={onaddcollection} title="Add collection" aria-label="Add collection to {group.name}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      {/if}
      {#if onedit}
        <button type="button" class="btn-action" onclick={onedit} title="Edit group" aria-label="Edit {group.name}">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
      {/if}
    </div>
  </header>
  {#if !collapsed}
    <div class="group-body">
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .group-section {
    margin-bottom: 1.5rem;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid color-mix(in srgb, var(--group-color) 25%, var(--border) 75%);
  }

  .header-spacer {
    flex: 1 0 0;
  }

  .btn-fold {
    display: grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    margin-left: -0.35rem;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .btn-fold:hover {
    background: var(--surface-tint);
  }

  .fold {
    transition: transform 0.15s;
  }

  .fold.open {
    transform: rotate(90deg);
  }

  .group-count {
    flex-shrink: 0;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .group-peek {
    min-width: 0;
    flex: 1 1 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .btn-board {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 1.85rem;
    padding: 0 0.6rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-board:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  .group-swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--group-color);
    flex-shrink: 0;
  }

  .group-name {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text);
    margin: 0;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group-actions {
    display: flex;
    gap: 0.15rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 150ms;
  }

  .group-header:hover .group-actions,
  .group-header:focus-within .group-actions {
    opacity: 1;
  }

  /* Always visible on touch */
  @media (hover: none) {
    .group-actions {
      opacity: 1;
    }
  }

  /* Add-collection button mirrors TodoRow's `.btn-quick-add`: tinted circular
     pill keyed off the group's colour so the "add" affordance carries the
     same visual vocabulary across Todos and Collections pages. Hover-reveal
     is handled by the parent `.group-actions` wrapper, so no opacity logic
     here — the button just inherits the wrapper's current opacity. */
  .btn-add-collection {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--group-color) 35%, var(--border) 65%);
    background: color-mix(in srgb, var(--group-color) 10%, var(--surface) 90%);
    color: var(--group-color);
    cursor: pointer;
    transition: background 150ms, border-color 150ms, transform 150ms;
    -webkit-tap-highlight-color: transparent;
  }

  .btn-add-collection:hover {
    background: color-mix(in srgb, var(--group-color) 22%, var(--surface) 78%);
    border-color: var(--group-color);
    transform: scale(1.05);
  }

  .btn-add-collection:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 2px;
  }

  /* Pencil edit stays intentionally flat/muted — secondary affordance that
     shouldn't compete with the primary "+" pill above. */
  .btn-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 150ms, background 150ms;
  }

  .btn-action:hover {
    color: var(--text);
    background: var(--surface-tint);
  }

  .group-body {
    min-width: 0;
  }
</style>
