<script lang="ts">
  let { onConfirm, onCancel, deleting = false }: {
    onConfirm: () => void;
    onCancel: () => void;
    deleting?: boolean;
  } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
  <div class="dialog">
    <p>Delete this item?</p>
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
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
    z-index: 10;
  }

  .dialog {
    text-align: center;
    padding: 1rem;
  }

  p {
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
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
    padding: 0.4rem 1rem;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .btn-cancel {
    background: var(--surface);
    color: var(--text);
  }

  .btn-confirm {
    background: var(--danger);
    color: white;
  }

  .btn-confirm:hover:not(:disabled) {
    background: var(--danger-hover);
  }

  .btn-confirm:disabled,
  .btn-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
