<script lang="ts">
  import { exportAllData, importAllData, triggerDownload } from '../lib/import-export';
  import type { ExportProgress, ImportProgress } from '../lib/import-export';

  let { open = $bindable(false) }: { open: boolean } = $props();

  type ModalState =
    | { kind: 'confirm-import'; file: File }
    | { kind: 'exporting'; progress: ExportProgress }
    | { kind: 'importing'; progress: ImportProgress }
    | { kind: 'done'; message: string }
    | { kind: 'error'; message: string };

  let state = $state<ModalState | null>(null);

  function close() {
    if (state?.kind === 'exporting' || state?.kind === 'importing') return;
    open = false;
    state = null;
  }

  /**
   * Window-level Escape — the backdrop's onkeydown only fires when focus is
   * inside the dialog, which isn't guaranteed (there's no autofocus target
   * when the modal is in its progress/done/error states). Listening at the
   * window ensures Escape always dismisses dismissable states. `close()`
   * already no-ops during exports/imports so mid-operation is safe.
   */
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) close();
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  export async function startExport() {
    open = true;
    state = { kind: 'exporting', progress: { phase: 'metadata', current: 0, total: 1 } };
    try {
      const blob = await exportAllData((progress) => {
        state = { kind: 'exporting', progress };
      });
      const date = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `inbox-rs-export-${date}.zip`);
      state = { kind: 'done', message: 'Export complete! Your download should start automatically.' };
    } catch (e) {
      state = { kind: 'error', message: `Export failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  export function promptImport(file: File) {
    open = true;
    state = { kind: 'confirm-import', file };
  }

  async function confirmImport() {
    if (state?.kind !== 'confirm-import') return;
    const file = state.file;
    state = { kind: 'importing', progress: { phase: 'reading', current: 0, total: 1 } };
    try {
      await importAllData(file, (progress) => {
        state = { kind: 'importing', progress };
      });
      state = { kind: 'done', message: 'Import complete! All data has been restored.' };
    } catch (e) {
      state = { kind: 'error', message: `Import failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  function progressLabel(s: ModalState): string {
    if (s.kind === 'exporting') {
      const p = s.progress;
      if (p.phase === 'metadata') return 'Loading data...';
      if (p.phase === 'files') return `Exporting files... ${p.current}/${p.total}`;
      return 'Creating archive...';
    }
    if (s.kind === 'importing') {
      const p = s.progress;
      if (p.phase === 'reading') return 'Reading archive...';
      if (p.phase === 'clearing') return `Clearing existing data... ${p.current}/${p.total}`;
      return `Restoring data... ${p.current}/${p.total}`;
    }
    return '';
  }

  // A `$derived` rather than a helper function so the value is referenced
  // as `{progressPercent}` directly in the template — biome's Svelte
  // parser tracks reactive bindings used in template expressions, but not
  // function calls inlined inside attribute string templates like
  // `style="width: {fn(...)}%"`. Using `$derived` keeps the lint rule
  // useful instead of forcing an override.
  const progressPercent = $derived.by(() => {
    if (!state || (state.kind !== 'exporting' && state.kind !== 'importing')) {
      return 0;
    }
    const p = state.progress;
    return p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if open && state}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="backdrop" role="dialog" aria-modal="true" onclick={onBackdropClick}>
    <div class="modal">
      {#if state.kind === 'confirm-import'}
        <h3>Import Data</h3>
        <p>Select a <strong>.zip</strong> file previously created with <strong>Export Data</strong>. This archive contains your items, collections, settings, and any attached files.</p>
        <p class="warning">This will <strong>replace all existing data</strong> with the contents of the import file. This cannot be undone.</p>
        <p class="file-name">{state.file.name}</p>
        <div class="actions">
          <button type="button" class="btn btn-secondary" onclick={close}>Cancel</button>
          <button type="button" class="btn btn-danger" onclick={confirmImport}>Replace All Data</button>
        </div>

      {:else if state.kind === 'exporting' || state.kind === 'importing'}
        <h3>{state.kind === 'exporting' ? 'Exporting' : 'Importing'}...</h3>
        <p class="progress-label">{progressLabel(state)}</p>
        <div class="progress-bar">
          <div class="progress-fill" style="width: {progressPercent}%"></div>
        </div>

      {:else if state.kind === 'done'}
        <h3>Done</h3>
        <p>{state.message}</p>
        <div class="actions">
          <button type="button" class="btn btn-primary" onclick={close}>Close</button>
        </div>

      {:else if state.kind === 'error'}
        <h3>Error</h3>
        <p class="error-message">{state.message}</p>
        <div class="actions">
          <button type="button" class="btn btn-secondary" onclick={close}>Close</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    max-width: 420px;
    width: 90%;
  }

  h3 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
    color: var(--text);
  }

  p {
    margin: 0 0 1rem;
    color: var(--text);
    opacity: 0.85;
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .warning {
    color: var(--danger);
    opacity: 1;
  }

  .file-name {
    font-family: monospace;
    font-size: 0.85rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg);
    border-radius: var(--radius-sm);
    word-break: break-all;
  }

  .error-message {
    color: var(--danger);
    opacity: 1;
  }

  .progress-label {
    opacity: 0.7;
  }

  .progress-bar {
    height: 6px;
    background: var(--bg);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 1rem;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.2s ease;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .btn {
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    font-size: 0.85rem;
    cursor: pointer;
    font-weight: 500;
  }

  .btn-secondary {
    background: var(--surface);
    color: var(--text);
  }

  .btn-secondary:hover {
    background: var(--bg);
  }

  .btn-primary {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .btn-primary:hover {
    opacity: 0.9;
  }

  .btn-danger {
    background: var(--danger);
    color: white;
    border-color: var(--danger);
  }

  .btn-danger:hover {
    opacity: 0.9;
  }
</style>
