import { mount } from 'svelte';
import { installPreloadErrorReload } from './lib/preload-error';
import {
  type Accent,
  applyPalette,
  applyTheme,
  isAccent,
  isPalette,
  type Mode,
  type Palette,
} from './lib/theme';
import './styles/global.css';

// Recover if a lazy chunk is temporarily unavailable during publication or a
// CDN inconsistency. Deploys retain old hashed assets, so this is a last line
// of defence rather than the normal update path (see lib/preload-error.ts).
installPreloadErrorReload();

// Apply the stored theme (accent + light/dark) before mount to avoid a flash.
// Mode is reconciled with synced UserSettings once connected (see UserMenu);
// accent is local-only, mirroring the quick-capture app.
// localStorage can throw a SecurityError when storage is blocked (private mode,
// blocked cookies, sandboxed iframe); fall back to defaults so mount proceeds.
let storedAccent: string | null = null;
let storedMode: string | null = null;
let storedPalette: string | null = null;
try {
  storedAccent = localStorage.getItem('inbox-rs:accent');
  storedMode = localStorage.getItem('inbox-rs:theme');
  storedPalette = localStorage.getItem('inbox-rs:palette');
} catch {
  // storage unavailable — keep defaults below
}
const accent: Accent = isAccent(storedAccent) ? storedAccent : 'indigo';
const mode: Mode =
  storedMode === 'light' || storedMode === 'dark' ? storedMode : 'system';
const palette: Palette = isPalette(storedPalette) ? storedPalette : 'paper';
applyTheme(accent, mode);
applyPalette(palette);

const target = document.getElementById('app');
if (!target) throw new Error('Mount target #app not found');
target.replaceChildren();

// Keep App behind an awaited dynamic boundary. Besides making a missing app
// chunk reject this entry (so app-loader can try a previous release), this
// gives remoteStorage's restored connection a turn to settle before the UI's
// file-loading components subscribe and mount.
const { default: App } = await import('./App.svelte');
const app = mount(App, { target });

export default app;
