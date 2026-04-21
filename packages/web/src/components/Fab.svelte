<script lang="ts">
  /**
   * Floating action button (FAB) — the accent-coloured circle pinned to the
   * bottom-right of the viewport. Used by pages that have a single primary
   * "add" action (Todos, Collections).
   *
   * Notable behaviour: the button slides upward as the page footer enters
   * the viewport, so it never sits on top of footer links (GitHub,
   * Downloads). This prevents misclicks on mobile where the FAB and footer
   * links otherwise occupy the same bottom-right area. The shift is driven
   * by a scroll listener that reads `.app-footer`'s bounding rect — if the
   * footer isn't in view, the offset is zero and the FAB sits at its normal
   * resting position.
   */
  let { onclick, label, title = undefined }: {
    onclick: () => void;
    /** Accessible name — announced by screen readers. */
    label: string;
    /** Optional tooltip; defaults to `label`. */
    title?: string;
  } = $props();

  let offsetY = $state(0);

  $effect(() => {
    const footer = document.querySelector('.app-footer');
    if (!footer) return;

    const update = () => {
      const rect = footer.getBoundingClientRect();
      const vh = window.innerHeight;
      // `vh - rect.top` is how many pixels of the footer are in the viewport
      // (from its top down to the viewport bottom). Clamped to ≥0 so the FAB
      // never shifts when the footer is below the fold.
      offsetY = Math.max(0, vh - rect.top);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  });
</script>

<button
  class="fab"
  onclick={onclick}
  aria-label={label}
  title={title ?? label}
  style="--fab-offset-y: {offsetY}px"
>
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
</button>

<style>
  .fab {
    position: fixed;
    bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
    right: calc(1.5rem + env(safe-area-inset-right, 0px));
    z-index: 50;
    width: 56px;
    height: 56px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 50%;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28), 0 1px 3px rgba(0, 0, 0, 0.18);
    cursor: pointer;
    /* Compose two transforms: footer-avoidance offset (JS-driven) + hover
       lift (static). Using calc on a custom property keeps the JS side to a
       single value while letting CSS handle the hover/active states. */
    transform: translateY(calc(var(--fab-offset-y, 0px) * -1));
    transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
    -webkit-tap-highlight-color: transparent;
  }

  .fab:hover {
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.2);
    background: color-mix(in srgb, var(--accent) 88%, white 12%);
    transform: translateY(calc(var(--fab-offset-y, 0px) * -1 - 2px));
  }

  .fab:active {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
    transform: translateY(calc(var(--fab-offset-y, 0px) * -1));
  }

  .fab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  @media (max-width: 600px) {
    .fab {
      bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
      right: calc(1rem + env(safe-area-inset-right, 0px));
    }
  }
</style>
