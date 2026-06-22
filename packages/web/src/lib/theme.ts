/**
 * Shared theme system for Inbox RS — used by both the main web app and the
 * quick-capture PWA. A theme is an **accent** (one of {@link ACCENTS}) plus a
 * light/dark **mode**. The accent palettes live in styles/theme-accents.css,
 * keyed off the `data-accent` attribute; light/dark neutrals are keyed off
 * `data-theme`. This module is the single source of truth for the accent list
 * and the apply helpers — each app layers its own persistence on top.
 */

export const ACCENTS = [
  'indigo',
  'forest',
  'plum',
  'teal',
  'slate',
  'rose',
  'mustard',
  'graphite',
] as const;

export type Accent = (typeof ACCENTS)[number];
export type Mode = 'light' | 'dark' | 'system';

/** Human labels for the settings UI. */
export const ACCENT_LABELS: Record<Accent, string> = {
  indigo: 'Indigo',
  forest: 'Forest',
  plum: 'Plum',
  teal: 'Teal',
  slate: 'Slate',
  rose: 'Rose',
  mustard: 'Mustard',
  graphite: 'Graphite',
};

/** Swatch colours for the picker — kept in sync with the accents in theme-accents.css. */
export const ACCENT_SWATCHES: Record<Accent, string> = {
  indigo: '#4f46e5',
  forest: '#3f7d54',
  plum: '#8a4a6f',
  teal: '#2f8079',
  slate: '#41607f',
  rose: '#b15775',
  mustard: '#8a6a1f',
  graphite: '#5b6b8c',
};

export function isAccent(value: string | null | undefined): value is Accent {
  return !!value && (ACCENTS as readonly string[]).includes(value);
}

/** Set the accent on the document root (palette comes from theme-accents.css). */
export function applyAccent(accent: Accent): void {
  document.documentElement.dataset.accent = accent;
}

/** Set light/dark mode on the document root; 'system' clears the override. */
export function applyMode(mode: Mode): void {
  const root = document.documentElement;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
    root.style.colorScheme = '';
  } else {
    root.setAttribute('data-theme', mode);
    root.style.colorScheme = mode;
  }
}

export function applyTheme(accent: Accent, mode: Mode): void {
  applyAccent(accent);
  applyMode(mode);
}
