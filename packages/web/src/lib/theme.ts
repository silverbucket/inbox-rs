/**
 * Shared theme system for Inbox RS — used by both the main web app and the
 * quick-capture PWA. A theme is an **accent** (one of {@link ACCENTS}) plus a
 * light/dark **mode** plus a neutral **palette** (one of {@link PALETTES}).
 * The accent palettes live in styles/theme-accents.css, keyed off the
 * `data-accent` attribute; light/dark neutrals are keyed off `data-theme`;
 * named neutral palettes are keyed off `data-palette` (styles/
 * theme-palettes.css, with the default palette inlined in global.css for
 * first paint). This module is the single source of truth for the accent and
 * palette lists and the apply helpers — each app layers its own persistence
 * on top.
 */

export const ACCENTS = [
  'indigo',
  'violet',
  'blue',
  'cyan',
  'teal',
  'forest',
  'mustard',
  'ember',
  'crimson',
  'rose',
  'magenta',
  'plum',
  'slate',
  'graphite',
] as const;

export type Accent = (typeof ACCENTS)[number];
export type Mode = 'light' | 'dark' | 'system';

/** Human labels for the settings UI. */
export const ACCENT_LABELS: Record<Accent, string> = {
  indigo: 'Indigo',
  violet: 'Violet',
  blue: 'Blue',
  cyan: 'Cyan',
  teal: 'Teal',
  forest: 'Forest',
  mustard: 'Mustard',
  ember: 'Ember',
  crimson: 'Crimson',
  rose: 'Rose',
  magenta: 'Magenta',
  plum: 'Plum',
  slate: 'Slate',
  graphite: 'Graphite',
};

/** Swatch colours for the picker — kept in sync with the accents in theme-accents.css. */
export const ACCENT_SWATCHES: Record<Accent, string> = {
  indigo: '#4f46e5',
  violet: '#7c3aed',
  blue: '#2563eb',
  cyan: '#0e7490',
  teal: '#2f8079',
  forest: '#3f7d54',
  mustard: '#8a6a1f',
  ember: '#c2410c',
  crimson: '#be123c',
  rose: '#b15775',
  magenta: '#a21caf',
  plum: '#8a4a6f',
  slate: '#41607f',
  graphite: '#5b6b8c',
};

export function isAccent(value: string | null | undefined): value is Accent {
  return !!value && (ACCENTS as readonly string[]).includes(value);
}

/**
 * Neutral palettes — each is a full light+dark set of background/surface/
 * text/border tokens. 'solarized' is the default (low-contrast, warm light /
 * blue-green dark); 'classic' is the original high-contrast cool grey. The
 * list is ordered along the cool→warm / crisp→soft axis so adjacent cards in
 * the picker read as a gradient rather than a random grid.
 */
export const PALETTES = [
  'classic',
  'frost',
  'paper',
  'solarized',
  'hearth',
  'dusk',
] as const;

export type Palette = (typeof PALETTES)[number];

export const PALETTE_LABELS: Record<Palette, string> = {
  classic: 'Classic',
  frost: 'Frost',
  paper: 'Paper',
  solarized: 'Solarized',
  hearth: 'Hearth',
  dusk: 'Dusk',
};

/** One-line character notes shown under each palette card. */
export const PALETTE_DESCRIPTIONS: Record<Palette, string> = {
  classic: 'Cool grey, crisp',
  frost: 'Cool blue, soft',
  paper: 'Warm ink on paper',
  solarized: 'Cream, muted',
  hearth: 'Warm and retro',
  dusk: 'Rosy and mauve',
};

/**
 * Colours the palette picker paints its preview cards with — kept in sync
 * with each palette's --bg / --sidebar-bg / --surface / --text tokens
 * (global.css for solarized, theme-palettes.css for the rest).
 */
export interface PalettePreview {
  bg: string;
  sidebar: string;
  surface: string;
  text: string;
}

export const PALETTE_PREVIEWS: Record<
  Palette,
  { light: PalettePreview; dark: PalettePreview }
> = {
  classic: {
    light: {
      bg: '#f8f9fb',
      sidebar: '#eef0f4',
      surface: '#ffffff',
      text: '#1a1d27',
    },
    dark: {
      bg: '#0f1117',
      sidebar: '#0a0c11',
      surface: '#1a1d27',
      text: '#e4e6eb',
    },
  },
  frost: {
    light: {
      bg: '#eceff4',
      sidebar: '#e5e9f0',
      surface: '#f7f9fc',
      text: '#2e3440',
    },
    dark: {
      bg: '#2e3440',
      sidebar: '#272c36',
      surface: '#3b4252',
      text: '#d8dee9',
    },
  },
  paper: {
    light: {
      bg: '#f3efe7',
      sidebar: '#ebe6dc',
      surface: '#fbf9f4',
      text: '#2b2925',
    },
    dark: {
      bg: '#1b1917',
      sidebar: '#141210',
      surface: '#262320',
      text: '#e6e1d8',
    },
  },
  solarized: {
    light: {
      bg: '#f6efdc',
      sidebar: '#eee8d5',
      surface: '#fdf6e3',
      text: '#586e75',
    },
    dark: {
      bg: '#002b36',
      sidebar: '#00222b',
      surface: '#073642',
      text: '#93a1a1',
    },
  },
  hearth: {
    light: {
      bg: '#fbf1c7',
      sidebar: '#f2e5bc',
      surface: '#f9f5d7',
      text: '#3c3836',
    },
    dark: {
      bg: '#282828',
      sidebar: '#1d2021',
      surface: '#32302f',
      text: '#ebdbb2',
    },
  },
  dusk: {
    light: {
      bg: '#faf4ed',
      sidebar: '#f2e9e1',
      surface: '#fffaf3',
      text: '#575279',
    },
    dark: {
      bg: '#191724',
      sidebar: '#13111c',
      surface: '#1f1d2e',
      text: '#e0def4',
    },
  },
};

export function isPalette(value: string | null | undefined): value is Palette {
  return !!value && (PALETTES as readonly string[]).includes(value);
}

/**
 * Browser-chrome tint per palette — kept in sync with each palette's `--bg`
 * (global.css for solarized, theme-palettes.css for the rest). index.html
 * ships the solarized values for first paint.
 */
export const PALETTE_THEME_COLORS: Record<
  Palette,
  { light: string; dark: string }
> = {
  classic: { light: '#f8f9fb', dark: '#0f1117' },
  frost: { light: '#eceff4', dark: '#2e3440' },
  paper: { light: '#f3efe7', dark: '#1b1917' },
  solarized: { light: '#f6efdc', dark: '#002b36' },
  hearth: { light: '#fbf1c7', dark: '#282828' },
  dusk: { light: '#faf4ed', dark: '#191724' },
};

/**
 * Set the neutral palette on the document root (styles/theme-palettes.css)
 * and retint the `theme-color` metas so the browser chrome follows it.
 */
export function applyPalette(palette: Palette): void {
  document.documentElement.dataset.palette = palette;
  const colors = PALETTE_THEME_COLORS[palette];
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    const media = meta.getAttribute('media') ?? '';
    meta.content = media.includes('light') ? colors.light : colors.dark;
  }
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
