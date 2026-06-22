/**
 * Theme configuration for the quick-capture app: a set of accent colours, each
 * rendered in light or dark mode. The palettes themselves live in styles.css,
 * keyed off `data-accent` / `data-mode` attributes on the document root — this
 * module only tracks and applies the user's selection.
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

/** Swatch colours for the settings picker (the accent of each theme). */
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

const ACCENT_KEY = 'inbox-rs-capture:accent';
const MODE_KEY = 'inbox-rs-capture:mode';

function isAccent(value: string | null): value is Accent {
  return !!value && (ACCENTS as readonly string[]).includes(value);
}

export function getAccent(): Accent {
  const stored = localStorage.getItem(ACCENT_KEY);
  return isAccent(stored) ? stored : 'indigo';
}

export function getMode(): Mode {
  const stored = localStorage.getItem(MODE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/** Apply a theme to the document root and persist the choice. */
export function applyTheme(accent: Accent, mode: Mode): void {
  const root = document.documentElement;
  root.dataset.accent = accent;
  if (mode === 'system') {
    delete root.dataset.mode;
  } else {
    root.dataset.mode = mode;
  }
  localStorage.setItem(ACCENT_KEY, accent);
  localStorage.setItem(MODE_KEY, mode);
}

/** Apply the stored (or default) theme — call once on startup. */
export function initTheme(): { accent: Accent; mode: Mode } {
  const accent = getAccent();
  const mode = getMode();
  applyTheme(accent, mode);
  return { accent, mode };
}
