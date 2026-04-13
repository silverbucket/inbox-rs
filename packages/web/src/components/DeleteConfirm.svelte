<script lang="ts">
  let { onConfirm, onCancel, deleting = false, message = 'Delete this item?' }: {
    onConfirm: () => void;
    onCancel: () => void;
    deleting?: boolean;
    message?: string;
  } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" onclick={onCancel}>
  <div class="dialog" onclick={(e) => e.stopPropagation()}>
    <p>{message}</p>
    <div class="actions">
      <button class="btn-cancel" onclick={onCancel} disabled={deleting}>Cancel</button>
      <button class="btn-confirm" onclick={onConfirm} disabled={deleting}>
        {deleting ? 'Deleting...' : 'Delete'}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    display: flex;
    z-index: 200;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .dialog {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    text-align: center;
    max-width: 340px;
    width: 100%;
    box-shadow: 0 12px 40px var(--shadow);
    margin: auto;
  }

  p {
    font-size: 0.9rem;
    margin-bottom: 1rem;
    line-height: 1.4;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }

  .btn-cancel,
  .btn-confirm {
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.45rem 1.1rem;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-cancel {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
  }

  .btn-cancel:hover:not(:disabled) {
    border-color: var(--text-muted);
  }

  .btn-confirm {
    background: var(--danger, #ef4444);
    color: white;
  }

  .btn-confirm:hover:not(:disabled) {
    background: var(--danger-hover, #dc2626);
  }

  .btn-confirm:disabled,
  .btn-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
