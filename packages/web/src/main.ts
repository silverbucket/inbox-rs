import { mount } from 'svelte';
import { type Accent, applyTheme, isAccent, type Mode } from './lib/theme';
import Root from './Root.svelte';

// Apply the stored theme (accent + light/dark) before mount to avoid a flash.
// Mode is reconciled with synced UserSettings once connected (see UserMenu);
// accent is local-only, mirroring the quick-capture app.
// localStorage can throw a SecurityError when storage is blocked (private mode,
// blocked cookies, sandboxed iframe); fall back to defaults so mount proceeds.
let storedAccent: string | null = null;
let storedMode: string | null = null;
try {
  storedAccent = localStorage.getItem('inbox-rs:accent');
  storedMode = localStorage.getItem('inbox-rs:theme');
} catch {
  // storage unavailable — keep defaults below
}
const accent: Accent = isAccent(storedAccent) ? storedAccent : 'indigo';
const mode: Mode =
  storedMode === 'light' || storedMode === 'dark' ? storedMode : 'system';
applyTheme(accent, mode);

const target = document.getElementById('app');
if (!target) throw new Error('Mount target #app not found');
const app = mount(Root, { target });

export default app;
