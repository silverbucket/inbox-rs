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
