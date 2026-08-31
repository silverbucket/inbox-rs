<script lang="ts">
  /**
   * The drag grip for a svelte-dnd-action `dragHandleZone` row.
   *
   * Shared by the sidebar's group and collection rows and the Collections
   * page's collection headers so all three grips are the same size, sit in the
   * same place, and reveal on the same rules.
   *
   * `dragHandle` sets `role="button"` and manages `tabindex` itself — it holds
   * the handle at 0 when idle and drops it to -1 mid-drag — so neither is
   * declared here. Writing `tabindex` in the markup only looks like it means
   * something; the action overwrites it on mount.
   *
   * The four `stopPropagation` handlers keep the press from reaching the row
   * beneath: the sidebar's collection row toggles a filter on click, and its
   * move button starts a native drag. Grabbing the grip must do neither.
   */
  import { dragHandle } from 'svelte-dnd-action';

  let { label }: { label: string } = $props();
</script>

<span
  class="reorder-grip"
  use:dragHandle
  aria-label={label}
  title="Drag to reorder"
  onmousedown={(e) => e.stopPropagation()}
  ontouchstart={(e) => e.stopPropagation()}
  onpointerdown={(e) => e.stopPropagation()}
  onclick={(e) => e.stopPropagation()}
>
  <svg aria-hidden="true" width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
    <circle cx="3" cy="3" r="1.25"/><circle cx="9" cy="3" r="1.25"/>
    <circle cx="3" cy="8" r="1.25"/><circle cx="9" cy="8" r="1.25"/>
    <circle cx="3" cy="13" r="1.25"/><circle cx="9" cy="13" r="1.25"/>
  </svg>
</span>

<style>
  /* 24×24 minimum, per WCAG 2.5.8. The box is also the region where
     `touch-action: none` suppresses scrolling — required for a vertical drag
     handle on touch — so it's kept to the minimum rather than made generous. */
  .reorder-grip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    min-height: 24px;
    align-self: stretch;
    flex: 0 0 24px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-muted);
    cursor: grab;
    /* Hosts raise this on row hover, and pin it on for touch, matching how
       `.row-add` and the Collections page's header actions already behave. */
    opacity: var(--row-action-opacity, 0);
    touch-action: none;
    user-select: none;
    transition: opacity 150ms, color 150ms;
  }

  .reorder-grip:hover,
  .reorder-grip:focus-visible {
    opacity: 1;
    color: var(--row-action-color, var(--accent));
  }

  .reorder-grip:active {
    cursor: grabbing;
  }
</style>
