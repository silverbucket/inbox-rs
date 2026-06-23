<!-- packages/web/src/components/CaptureBar.svelte -->
<script lang="ts">
  import { detectCaptureKind } from '../lib/capture-detect';
  import { modLabel } from '../lib/platform';

  let {
    oncapture,
    onopeneditor,
    onfile,
    onrecord,
  }: {
    oncapture: (raw: string) => void;
    onopeneditor: (text: string) => void;
    onfile: (file: File) => void;
    onrecord: () => void;
  } = $props();

  let value = $state('');
  let focused = $state(false);
  let fileInputEl = $state<HTMLInputElement | null>(null);
  const mod = modLabel();

  const detected = $derived(detectCaptureKind(value));
  const enterHint = $derived(
    detected.kind === 'bookmark' ? 'Save bookmark' : 'Save as note',
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

  function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) onfile(file);
    input.value = ''; // let the user re-pick the same file later
  }
</script>

<div class="capture">
  <div class="bar">
    <button
      class="icon plus"
      type="button"
      aria-label="Attach a file"
      onclick={() => fileInputEl?.click()}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>
    <input
      class="text-input"
      type="text"
      placeholder="Paste a link, jot a note, or drop a file…"
      bind:value
      onkeydown={onKeydown}
      onfocus={() => (focused = true)}
      onblur={() => (focused = false)}
    />
    <button
      class="icon mic"
      type="button"
      aria-label="Record a voice memo"
      onclick={onrecord}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
    </button>
    <!-- Routed by the chosen file's type in the parent; visually hidden (not
         display:none, so Safari still opens it on the ⊕ click). -->
    <input
      class="file-input"
      type="file"
      bind:this={fileInputEl}
      onchange={onFileChange}
      aria-hidden="true"
      tabindex="-1"
    />
  </div>
  {#if focused && value.trim()}
    <div class="hint">
      <span>↵ {enterHint}</span>
      <span class="sep">·</span>
      <span>{mod}↵ Open editor</span>
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
  .icon {
    width: 30px; height: 30px;
    flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: none; border-radius: 8px;
    cursor: pointer;
  }
  .icon svg { width: 16px; height: 16px; }
  .plus { background: var(--accent-subtle); color: var(--accent); }
  .plus:hover { background: var(--accent-subtle-strong); }
  .mic { background: none; color: var(--text-muted); }
  .mic:hover { background: var(--surface-hover); color: var(--text); }
  .text-input {
    flex: 1; min-width: 0;
    border: none; outline: none; background: none;
    font: inherit; color: var(--text);
    /* Explicit >=1rem so iOS doesn't auto-zoom on focus. */
    font-size: 1rem;
  }
  .text-input::placeholder { color: var(--text-muted); }
  .file-input {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .hint {
    display: flex; gap: 0.5rem; align-items: center;
    padding: 0.35rem 0.6rem 0;
    font-size: 0.78rem; color: var(--text-muted);
  }
  .hint .sep { opacity: 0.4; }
</style>
