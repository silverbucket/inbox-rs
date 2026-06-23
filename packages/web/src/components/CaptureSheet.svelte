<!-- packages/web/src/components/CaptureSheet.svelte -->
<script lang="ts">
  import { autofocus } from '../lib/actions';

  let {
    oncapture,
    onfile,
    onrecord,
    onclose,
  }: {
    oncapture: (raw: string) => void;
    onfile: (file: File) => void;
    onrecord: () => void;
    onclose: () => void;
  } = $props();

  let value = $state('');
  let fileInputEl = $state<HTMLInputElement | null>(null);
  const canSave = $derived(!!value.trim());

  function save() {
    if (!canSave) return;
    oncapture(value);
    value = '';
    onclose();
  }

  function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      onfile(file);
      onclose();
    }
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />

<div class="sheet" role="dialog" aria-modal="true" aria-label="Capture">
  <header>
    <button class="close" type="button" aria-label="Close" onclick={onclose}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <button class="save" type="button" disabled={!canSave} onclick={save}>Save</button>
  </header>
  <textarea
    use:autofocus
    bind:value
    placeholder="Paste a link, jot a note…"
  ></textarea>
  <footer>
    <button class="attach" type="button" onclick={() => fileInputEl?.click()}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      Attach file
    </button>
    <button class="record" type="button" onclick={onrecord}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
      Voice memo
    </button>
    <input
      class="file-input"
      type="file"
      bind:this={fileInputEl}
      onchange={onFileChange}
      aria-hidden="true"
      tabindex="-1"
    />
  </footer>
</div>

<style>
  .sheet {
    position: fixed;
    inset: 0;
    z-index: 150;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    padding: env(safe-area-inset-top) env(safe-area-inset-right)
      env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .close {
    width: 38px; height: 38px;
    display: inline-flex; align-items: center; justify-content: center;
    border: none; background: none; color: var(--text-muted); cursor: pointer;
  }
  .close svg { width: 20px; height: 20px; }
  .save {
    border: none; border-radius: 999px;
    padding: 0.45rem 1.1rem;
    background: var(--accent); color: white;
    font: inherit; font-weight: 600; cursor: pointer;
  }
  .save:disabled { opacity: 0.5; cursor: default; }
  textarea {
    flex: 1; min-height: 0; resize: none;
    border: none; outline: none; background: none;
    padding: 1.1rem;
    font: inherit; font-size: 1.05rem; color: var(--text);
  }
  footer {
    display: flex; gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border);
  }
  footer button {
    display: inline-flex; align-items: center; gap: 0.4rem;
    border: 1px solid var(--border); border-radius: 0.6rem;
    background: var(--surface); color: var(--text);
    padding: 0.5rem 0.85rem; font: inherit; cursor: pointer;
  }
  .attach svg, .record svg { width: 16px; height: 16px; }
  .file-input {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
