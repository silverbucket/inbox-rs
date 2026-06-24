<!-- packages/web/src/components/CaptureBar.svelte -->
<script lang="ts">
  import { autofocusIf } from '../lib/actions';
  import { detectCaptureKind } from '../lib/capture-detect';
  import { modLabel } from '../lib/platform';

  let {
    oncapture,
    onopeneditor,
    onfile,
    onrecord,
    focusOnMount = false,
  }: {
    oncapture: (raw: string) => void;
    onopeneditor: (text: string) => void;
    onfile: (file: File) => void;
    onrecord: () => void;
    /** Focus the input on mount (the inbox does; the collection view doesn't,
        to avoid stealing focus when a collection is expanded). */
    focusOnMount?: boolean;
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
      use:autofocusIf={focusOnMount}
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
  <!-- Always rendered with a fixed height so the hint appearing on focus
       never shifts the content below it. -->
  <div class="hint">
    {#if focused && value.trim()}
      <span>↵ {enterHint}</span>
      <span class="sep">·</span>
      <span>{mod}↵ Open editor</span>
    {/if}
  </div>
</div>

<style>
  .capture { position: relative; width: 100%; }
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
    /* Fixed height reserves the space permanently — the hint fading in on
       focus must not push content below. */
    min-height: 1.4rem;
    /* Left-align the hint to where the input text starts (past the ⊕ button),
       so it sits directly under what you're typing rather than at the bar edge.
       = bar padding-left + plus button width + bar gap. */
    padding: 0.2rem 0.6rem 0 calc(0.75rem + 30px + 0.6rem);
    font-size: 0.78rem; color: var(--text-muted);
  }
  .hint .sep { opacity: 0.4; }
</style>
