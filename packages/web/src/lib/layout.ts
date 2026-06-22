/**
 * App layout selection — which shell renders the main UI. Persisted per-device
 * in localStorage (mirrors the theme keys); not synced via remoteStorage.
 * 'classic' is the established top-nav layout; 'sidebar' is the opt-in redesign.
 */

export type Layout = 'classic' | 'sidebar';

const LAYOUT_KEY = 'inbox-rs:layout';
const DEFAULT_LAYOUT: Layout = 'classic';

function isLayout(value: string | null): value is Layout {
  return value === 'classic' || value === 'sidebar';
}

/** Read the stored layout, falling back to the default. */
export function getLayout(): Layout {
  // localStorage can throw a SecurityError when storage is blocked (private
  // mode, blocked cookies, sandboxed iframe); fall back to the default.
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    return isLayout(stored) ? stored : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** Persist the chosen layout (best-effort — ignores blocked storage). */
export function setLayout(layout: Layout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // storage unavailable — selection won't persist across reloads
  }
}
