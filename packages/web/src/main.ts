import { mount } from 'svelte';
import { type Accent, applyTheme, isAccent, type Mode } from './lib/theme';
import Root from './Root.svelte';

// Apply the stored theme (accent + light/dark) before mount to avoid a flash.
// Mode is reconciled with synced UserSettings once connected (see UserMenu);
// accent is local-only, mirroring the quick-capture app.
const storedAccent = localStorage.getItem('inbox-rs:accent');
const accent: Accent = isAccent(storedAccent) ? storedAccent : 'indigo';
const storedMode = localStorage.getItem('inbox-rs:theme');
const mode: Mode =
  storedMode === 'light' || storedMode === 'dark' ? storedMode : 'system';
applyTheme(accent, mode);

const target = document.getElementById('app');
if (!target) throw new Error('Mount target #app not found');
const app = mount(Root, { target });

export default app;
