<script lang="ts">
  /**
   * Primary "add" button for pages that have a single dominant create action
   * (Todos, Collections). Renders two visual personas from the same DOM node:
   *
   *   - **Desktop (>768px)**: inline labelled pill, styled like a toolbar
   *     primary button. Placed inside `.page-toolbar` in the parent so it
   *     sits next to related controls (counts, "Expand all" toggles). No
   *     floating cornerwards — the cursor is already near the content.
   *
   *   - **Mobile (≤768px)**: floating circular FAB pinned to the bottom-right
   *     thumb zone. The label collapses to screen-reader-only and the icon
   *     takes over, matching the platform convention on phones.
   *
   * Parents render this in the toolbar in both cases. On mobile the button
   * uses `position: fixed`, which removes it from the flex flow, so an
   * otherwise-empty toolbar collapses to zero height on small screens.
   *
   * Mobile-only behaviour: the button slides upward as the page footer
   * enters the viewport, so it never sits on top of the footer links
   * (GitHub, Downloads). The shift is driven by a scroll listener that
   * reads `.app-footer`'s bounding rect — if the footer isn't in view, the
   * offset is zero and the FAB sits at its normal resting position. The
   * listener is only attached when the viewport matches the mobile
   * breakpoint; on desktop there's no floating button to offset.
   */
  let { onclick, label, title = undefined }: {
    onclick: () => void;
    /** Accessible name — announced by screen readers. Also shown as the
        visible label inside the inline desktop pill. */
    label: string;
    /** Optional tooltip; defaults to `label`. */
    title?: string;
  } = $props();

  let offsetY = $state(0);

  $effect(() => {
    const mql = window.matchMedia('(max-width: 768px)');

    let cleanup: (() => void) | undefined;

    const attach = () => {
      if (!mql.matches) {
        // Desktop: no floating button, so no footer-avoidance work needed.
        offsetY = 0;
        return;
      }

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
      cleanup = () => {
        window.removeEventListener('scroll', update);
        window.removeEventListener('resize', update);
      };
    };

    attach();

    // Re-evaluate when the viewport crosses the breakpoint (e.g. browser
    // resize, device rotation). Detaches the scroll listener on the desktop
    // side of the threshold so it doesn't run needlessly.
    const onBreakpointChange = () => {
      cleanup?.();
      cleanup = undefined;
      attach();
    };
    mql.addEventListener('change', onBreakpointChange);

    return () => {
      cleanup?.();
      mql.removeEventListener('change', onBreakpointChange);
    };
  });
</script>

<button
  type="button"
  class="fab"
  onclick={onclick}
  aria-label={label}
  title={title ?? label}
  style="--fab-offset-y: {offsetY}px"
>
  <svg class="fab-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
  <span class="fab-label">{label}</span>
</button>

<style>
  /*
   * Desktop default: inline accent pill. Sits in the toolbar's flex flow,
   * labelled so the action is discoverable at a glance.
   */
  .fab {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.45rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    font-family: inherit;
    line-height: 1.2;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    transition: background 180ms ease, box-shadow 180ms ease, transform 180ms ease;
    -webkit-tap-highlight-color: transparent;
  }

  .fab:hover {
    background: color-mix(in srgb, var(--accent) 88%, white 12%);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  }

  .fab:active {
    transform: translateY(1px);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .fab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .fab-icon {
    flex-shrink: 0;
  }

  .fab-label {
    white-space: nowrap;
  }

  /*
   * Mobile: promote to a floating circular FAB in the thumb zone. Icon-only;
   * the label becomes screen-reader-only via clip-path. Fixed positioning
   * escapes any parent container so the button stays reachable as the user
   * scrolls — the hover/active transforms compose with the footer-avoidance
   * offset via the `--fab-offset-y` custom property.
   */
  @media (max-width: 768px) {
    .fab {
      position: fixed;
      bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
      right: calc(1.5rem + env(safe-area-inset-right, 0px));
      z-index: 50;
      width: 56px;
      height: 56px;
      padding: 0;
      border-radius: 50%;
      justify-content: center;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28), 0 1px 3px rgba(0, 0, 0, 0.18);
      transform: translateY(calc(var(--fab-offset-y, 0px) * -1));
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

    .fab-icon {
      width: 24px;
      height: 24px;
    }

    /* Visually hide but keep accessible for screen readers. */
    .fab-label {
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
  }

  @media (max-width: 600px) {
    .fab {
      bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
      right: calc(1rem + env(safe-area-inset-right, 0px));
    }
  }
</style>
