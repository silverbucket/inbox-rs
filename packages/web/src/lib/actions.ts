/**
 * Small DOM actions shared across components.
 *
 * Keeping this file deliberately tiny — actions that only need a handful of
 * lines belong here rather than their own module. Grow into separate files
 * only when a single action gets meaningfully complex.
 */

/**
 * Focus the bound element on the next animation frame.
 *
 * Used by modal text inputs so the user can start typing immediately when the
 * modal appears. The rAF delay lets layout/portal timing settle before the
 * focus call — focusing synchronously during mount fights with Svelte's
 * transitions on some browsers (Safari in particular).
 *
 * Example:
 * ```svelte
 * <input use:autofocus type="text" bind:value={title} />
 * ```
 */
export function autofocus(node: HTMLElement) {
  requestAnimationFrame(() => node.focus());
}

/**
 * Conditional variant of {@link autofocus}. Focuses the bound element on the
 * next animation frame only when `enabled` is true.
 *
 * Use when the same `<input>` markup is rendered in multiple branches and
 * only some branches should grab focus on mount — for example, an empty-state
 * hero composer that should autofocus vs. a compact composer rendered above
 * an existing list, where stealing focus would interrupt the user.
 *
 * Example:
 * ```svelte
 * <input use:autofocusIf={!compact} type="text" bind:value={title} />
 * ```
 *
 * Lives here (rather than as a local helper in the consuming component) so
 * biome's Svelte parser can see the import is used — local helpers
 * referenced only via `use:` directives are invisible to biome's
 * unused-variable analysis and get falsely flagged.
 */
export function autofocusIf(node: HTMLElement, enabled: boolean) {
  if (enabled) requestAnimationFrame(() => node.focus());
}

/**
 * Dialogs currently holding a focus trap, in mount order. Only the topmost
 * (last-mounted) trap acts on Tab — without this, a dialog stacked on
 * another (CalendarPicker over ScheduleSheet) would have both window-level
 * handlers fighting: the lower one sees focus "outside itself" and yanks
 * it back out of the upper dialog.
 */
const trapStack: HTMLElement[] = [];

/**
 * Contain keyboard focus within the bound dialog element.
 *
 * `aria-modal` alone doesn't move or trap focus — a keyboard user can Tab
 * to controls behind the overlay. This action: focuses the first focusable
 * descendant on mount (unless something inside is already focused, e.g. via
 * `use:autofocus`), cycles Tab/Shift-Tab at the edges, and restores focus
 * to the previously focused element when the dialog unmounts. Stacked
 * dialogs coordinate through {@link trapStack}.
 *
 * Example:
 * ```svelte
 * <div class="sheet" role="dialog" aria-modal="true" use:trapFocus>
 * ```
 */
export function trapFocus(node: HTMLElement) {
  const previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  trapStack.push(node);

  const focusables = (): HTMLElement[] =>
    Array.from(
      node.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);

  requestAnimationFrame(() => {
    if (!node.contains(document.activeElement)) focusables()[0]?.focus();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    // Only the topmost trap acts; lower dialogs stay inert until they
    // surface again.
    if (trapStack[trapStack.length - 1] !== node) return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    // Also catch focus that escaped (or never entered) the dialog.
    if (e.shiftKey && (active === first || !node.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !node.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  // Window-level: a node listener would miss Tab presses once focus has
  // escaped the dialog (the exact case the trap must recover from).
  window.addEventListener('keydown', handleKeydown, true);
  return {
    destroy: () => {
      window.removeEventListener('keydown', handleKeydown, true);
      const idx = trapStack.indexOf(node);
      if (idx !== -1) trapStack.splice(idx, 1);
      previouslyFocused?.focus();
    },
  };
}

/** Apply the focus trap only while `enabled` is true. */
export function trapFocusWhen(node: HTMLElement, enabled: boolean) {
  let trap = enabled ? trapFocus(node) : undefined;

  return {
    update(nextEnabled: boolean) {
      trap?.destroy();
      trap = nextEnabled ? trapFocus(node) : undefined;
    },
    destroy() {
      trap?.destroy();
    },
  };
}

/**
 * Run `onEnter` once when the bound element first approaches the viewport.
 *
 * Used to gate expensive work (binary fetches for card media) on visibility,
 * so opening a large inbox doesn't kick off a fetch for every image at once.
 * The 400px rootMargin starts loading a little before the element scrolls
 * into view, so media is usually ready by the time it's visible.
 *
 * Falls back to firing immediately when IntersectionObserver is unavailable
 * (very old browsers, some test environments).
 *
 * Example:
 * ```svelte
 * <div use:inview={() => loadFileBlobUrl(item.filePath, item.mimeType)}>
 * ```
 */
export function inview(node: HTMLElement, onEnter: () => void) {
  if (typeof IntersectionObserver === 'undefined') {
    onEnter();
    return {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        onEnter();
        io.disconnect();
      }
    },
    { rootMargin: '400px' },
  );
  io.observe(node);
  return { destroy: () => io.disconnect() };
}
