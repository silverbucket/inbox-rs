<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { CollectionGroup } from '@inbox-rs/rs-module';

  let { group, onedit, onaddcollection = undefined, children }: {
    group: CollectionGroup;
    /** Omit to hide the edit button. */
    onedit?: () => void;
    onaddcollection?: () => void;
    children: Snippet;
  } = $props();
</script>

<section class="group-section" style="--group-color: {group.color || 'var(--accent)'}">
  <header class="group-header">
    <span class="group-swatch"></span>
    <h2 class="group-name">{group.name}</h2>
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
  <div class="group-body">
    {@render children()}
  </div>
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
    flex: 1;
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
    outline: 2px solid var(--accent);
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
