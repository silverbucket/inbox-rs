<!-- packages/web/src/components/CaptureBar.svelte -->
<script lang="ts">
  import { autofocusIf } from '../lib/actions';
  import { detectCaptureKind } from '../lib/capture-detect';
  import { modLabel } from '../lib/platform';

  let {
    oncapture,
    onopeneditor,
    onfile,
    onfilecapture,
    onextrafiles,
    onrecord,
    focusOnMount = false,
  }: {
    oncapture: (raw: string) => void;
    onopeneditor: (text: string) => void;
    /** The ⊕ picker: opens the full add-entry form with the file pre-attached. */
    onfile: (file: File) => void;
    /** Drop/paste: store the staged file directly (chrome-less), with the
        typed text as its caption. Enter confirms; the parent offers Undo. */
    onfilecapture: (file: File, caption: string) => void;
    /** Fired when a drop carried more than one file — only the first is
        captured; the parent surfaces "ignored the rest". */
    onextrafiles?: (ignored: number) => void;
    onrecord: () => void;
    /** Focus the input on mount (the inbox does; the collection view doesn't,
        to avoid stealing focus when a collection is expanded). */
    focusOnMount?: boolean;
  } = $props();

  let value = $state('');
  let focused = $state(false);
  let fileInputEl = $state<HTMLInputElement | null>(null);
  let textInputEl = $state<HTMLInputElement | null>(null);
  // A file dropped or pasted onto the bar, staged as a chip until Enter
  // confirms it (Escape or the chip's ✕ discards).
  let pendingFile = $state<File | null>(null);
  let dragOver = $state(false);
  const mod = modLabel();

  const detected = $derived(detectCaptureKind(value));
  const enterHint = $derived(
    detected.kind === 'bookmark' ? 'Save bookmark' : 'Save as note',
  );
  const pendingIsImage = $derived(!!pendingFile?.type.startsWith('image/'));

  function confirmPending() {
    if (!pendingFile) return;
    onfilecapture(pendingFile, value.trim());
    pendingFile = null;
    value = '';
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && pendingFile) {
      e.preventDefault();
      pendingFile = null;
      return;
    }
    if (e.key !== 'Enter') return;
    // A staged file takes precedence over text detection: Enter stores it,
    // using whatever's typed as the caption.
    if (pendingFile) {
      e.preventDefault();
      confirmPending();
      return;
    }
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

  /** Stage the first of `files`, report any extras, and focus the input so
      Enter/Escape and caption-typing work immediately (a drop doesn't focus
      the input on its own). */
  function stageFiles(files: File[]) {
    if (files.length === 0) return;
    pendingFile = files[0];
    if (files.length > 1) onextrafiles?.(files.length - 1);
    textInputEl?.focus();
  }

  function onPaste(e: ClipboardEvent) {
    // Prefer an image on the clipboard over its text/URL representation.
    const imageFiles = Array.from(e.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (imageFiles.length === 0) return;
    e.preventDefault();
    stageFiles(imageFiles);
  }

  function onDragOver(e: DragEvent) {
    // Only react to file drags, not text selections dragged within the input.
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragOver = true;
  }

  // dragleave also fires when the cursor crosses onto a child (button, chip,
  // input); ignore those so the highlight doesn't flicker — only clear when the
  // pointer actually leaves the bar.
  function onDragLeave(e: DragEvent) {
    if ((e.currentTarget as Node).contains(e.relatedTarget as Node | null)) return;
    dragOver = false;
  }

  function onDrop(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragOver = false;
    stageFiles(Array.from(e.dataTransfer.files));
  }

  function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) onfile(file);
    input.value = ''; // let the user re-pick the same file later
  }
</script>

<div class="capture">
  <div
    class="bar"
    class:drag-over={dragOver}
    role="group"
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
  >
    <button
      class="icon plus"
      type="button"
      aria-label="Attach a file"
      onclick={() => fileInputEl?.click()}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>
    {#if pendingFile}
      <span class="chip" title={pendingFile.name}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          {#if pendingIsImage}
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
          {:else}
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
          {/if}
        </svg>
        <span class="chip-name">{pendingFile.name}</span>
        <button
          type="button"
          class="chip-remove"
          aria-label="Remove attachment"
          onclick={() => (pendingFile = null)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </span>
    {/if}
    <input
      bind:this={textInputEl}
      use:autofocusIf={focusOnMount}
      class="text-input"
      type="text"
      placeholder={pendingFile
        ? 'Add a caption…'
        : 'Paste a link, jot a note, or drop a file…'}
      bind:value
      onkeydown={onKeydown}
      onpaste={onPaste}
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
    {#if pendingFile}
      <span>↵ Save {pendingIsImage ? 'image' : 'file'}</span>
      <span class="sep">·</span>
      <span>⎋ Discard</span>
    {:else if focused && value.trim()}
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
  /* Drop target: a dashed accent outline that reads as "release here" without
     shifting layout (border stays 1px; box-shadow draws the emphasis). */
  .bar.drag-over {
    border-color: var(--accent);
    border-style: dashed;
    box-shadow: 0 0 0 2px var(--accent-subtle);
  }
  .chip {
    display: inline-flex; align-items: center; gap: 0.35rem;
    flex-shrink: 0; max-width: 45%;
    padding: 0.2rem 0.35rem 0.2rem 0.5rem;
    background: var(--accent-subtle); color: var(--accent);
    border-radius: 8px;
    font-size: 0.8rem;
  }
  .chip svg { width: 14px; height: 14px; flex-shrink: 0; }
  .chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip-remove {
    display: inline-flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    width: 18px; height: 18px; padding: 0;
    border: none; border-radius: 5px;
    background: none; color: inherit; cursor: pointer;
  }
  .chip-remove svg { width: 12px; height: 12px; }
  .chip-remove:hover { background: var(--accent-subtle-strong); }
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
