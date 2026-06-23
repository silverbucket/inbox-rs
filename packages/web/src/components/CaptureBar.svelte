<!-- packages/web/src/components/CaptureBar.svelte -->
<script lang="ts">
  import { detectCaptureKind } from '../lib/capture-detect';
  import { modLabel } from '../lib/platform';

  let {
    oncapture,
    onopeneditor,
    onpick,
  }: {
    oncapture: (raw: string) => void;
    onopeneditor: (text: string) => void;
    onpick: (type: 'image' | 'document' | 'audio' | 'note') => void;
  } = $props();

  let value = $state('');
  let focused = $state(false);
  let menuOpen = $state(false);
  const mod = modLabel();

  const detected = $derived(detectCaptureKind(value));
  const enterHint = $derived(
    detected.kind === 'bookmark' ? 'Save bookmark' :
    detected.kind === 'note' ? 'Save as note' : '',
  );

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      onopeneditor(value);
      value = '';
      return;
    }
    if (detectCaptureKind(value).kind === 'empty') return;
    e.preventDefault();
    oncapture(value);
    value = '';
  }

  function pick(type: 'image' | 'document' | 'audio' | 'note') {
    menuOpen = false;
    onpick(type);
  }
</script>

<div class="capture">
  <div class="bar">
    <button
      class="plus"
      type="button"
      aria-label="Add attachment or note"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>
    <input
      type="text"
      placeholder="Paste a link, jot a note, or drop a file…"
      bind:value
      onkeydown={onKeydown}
      onfocus={() => (focused = true)}
      onblur={() => (focused = false)}
    />
  </div>
  {#if focused && value.trim()}
    <div class="hint">
      <span>↵ {enterHint}</span>
      <span class="sep">·</span>
      <span>{mod}↵ Open editor</span>
    </div>
  {/if}
  {#if menuOpen}
    <div class="menu" role="menu">
      <button type="button" role="menuitem" onclick={() => pick('note')}>Note editor</button>
      <button type="button" role="menuitem" onclick={() => pick('image')}>Image</button>
      <button type="button" role="menuitem" onclick={() => pick('document')}>File</button>
      <button type="button" role="menuitem" onclick={() => pick('audio')}>Voice memo</button>
    </div>
  {/if}
</div>

<style>
  .capture { position: relative; max-width: 720px; width: 100%; margin: 0 auto; }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.85rem;
    padding: 0.5rem 0.75rem;
  }
  .bar:focus-within { border-color: var(--accent); }
  .plus {
    width: 30px; height: 30px;
    flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: none; border-radius: 8px;
    background: var(--accent-subtle); color: var(--accent);
    cursor: pointer;
  }
  .plus svg { width: 16px; height: 16px; }
  input {
    flex: 1; min-width: 0;
    border: none; outline: none; background: none;
    font: inherit; color: var(--text);
  }
  input::placeholder { color: var(--text-muted); }
  .hint {
    display: flex; gap: 0.5rem; align-items: center;
    padding: 0.35rem 0.6rem 0;
    font-size: 0.78rem; color: var(--text-muted);
  }
  .hint .sep { opacity: 0.4; }
  .menu {
    position: absolute; top: calc(100% + 0.35rem); left: 0;
    z-index: 50;
    display: flex; flex-direction: column;
    min-width: 12rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    padding: 0.3rem;
    box-shadow: 0 12px 30px -12px var(--shadow);
  }
  .menu button {
    text-align: left;
    border: none; background: none;
    padding: 0.5rem 0.6rem; border-radius: 0.4rem;
    font: inherit; color: var(--text); cursor: pointer;
  }
  .menu button:hover { background: var(--surface-hover); }
</style>
