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
