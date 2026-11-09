<script lang="ts">
  let {
    onConfirm,
    onCancel,
    deleting = false,
    message = 'Delete permanently? This can’t be undone.',
    calendarName,
    mayReturn = false,
  }: {
    /** The card follows a collection link, so a later change to the kept
        entry brings it back. */
    mayReturn?: boolean;
    /** `alsoCalendar`: also delete the synced calendar entry. */
    onConfirm: (options: { alsoCalendar: boolean }) => void;
    onCancel: () => void;
    deleting?: boolean;
    message?: string;
    /** The calendar a synced card's entry lives in — offers deleting it too. */
    calendarName?: string;
  } = $props();

  let alsoCalendar = $state(true);

  /**
   * Escape cancels the confirm. If we're already mid-delete, ignore so the
   * user can't dismiss a dialog that's about to mutate state out from under
   * them.
   */
  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || deleting) return;
    onCancel();
  }
</script>

<svelte:window onkeydown={handleEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" onclick={() => { if (!deleting) onCancel(); }}>
  <div class="dialog" onclick={(e) => e.stopPropagation()}>
    <p>{message}</p>
    {#if calendarName}
      <label class="also">
        <input type="checkbox" bind:checked={alsoCalendar} disabled={deleting} />
        <span>Also delete it from the <strong>{calendarName}</strong> calendar</span>
      </label>
      <p class="also-hint">
        {alsoCalendar
          ? 'Gone from both places. This can’t be undone.'
          : mayReturn
            ? `It stays in the ${calendarName} calendar, and only comes back here if it changes there.`
            : `It stays in the ${calendarName} calendar.`}
      </p>
    {/if}
    <div class="actions">
      <button type="button" class="btn-cancel" onclick={onCancel} disabled={deleting}>Cancel</button>
      <button type="button" class="btn-confirm" onclick={() => onConfirm({ alsoCalendar: !!calendarName && alsoCalendar })} disabled={deleting}>
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
    overflow-y: auto;
    overscroll-behavior: contain;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
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
  }

  p {
    font-size: 0.9rem;
    margin-bottom: 1rem;
    line-height: 1.4;
  }

  .also {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin: -0.25rem 0 1rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    cursor: pointer;
    min-height: 44px;
  }

  .also-hint {
    margin: -0.85rem 0 1rem;
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .also input {
    width: 18px;
    height: 18px;
    accent-color: var(--danger);
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
