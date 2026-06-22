/**
 * Quick-capture theme — a thin wrapper over the shared theme module
 * (lib/theme), adding the capture app's own persistence keys. This way both the
 * capture PWA and the main app offer the exact same eight accents × light/dark
 * from a single source of truth.
 */
import {
  ACCENT_LABELS,
  ACCENT_SWATCHES,
  ACCENTS,
  type Accent,
  applyTheme as applyThemeToDom,
  isAccent,
  type Mode,
} from '../lib/theme';

export type { Accent, Mode };
export { ACCENT_LABELS, ACCENT_SWATCHES, ACCENTS };

const ACCENT_KEY = 'inbox-rs-capture:accent';
const MODE_KEY = 'inbox-rs-capture:mode';

export function getAccent(): Accent {
  const stored = localStorage.getItem(ACCENT_KEY);
  return isAccent(stored) ? stored : 'indigo';
}

export function getMode(): Mode {
  const stored = localStorage.getItem(MODE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/** Apply the theme to the document and persist the capture app's choice. */
export function applyTheme(accent: Accent, mode: Mode): void {
  applyThemeToDom(accent, mode);
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
