<script lang="ts">
  import type { Snippet } from 'svelte';
  import { PRESET_COLORS } from '../lib/constants';
  import { autofocus } from '../lib/actions';

  let {
    entityName,
    title = undefined,
    isEdit = false,
    name = $bindable(''),
    color = $bindable('#6366f1'),
    showDescription = false,
    description = $bindable(''),
    namePlaceholder = '',
    descriptionPlaceholder = '',
    maxWidth = '440px',
    onclose,
    onsubmit: handleFormSubmit,
    ondelete = undefined,
    extraFields = undefined,
    canSubmit = true,
  }: {
    entityName: string;
    title?: string;
    isEdit?: boolean;
    name: string;
    color: string;
    showDescription?: boolean;
    description?: string;
    namePlaceholder?: string;
    descriptionPlaceholder?: string;
    maxWidth?: string;
    onclose: () => void;
    onsubmit: () => void;
    ondelete?: () => void;
    /** Optional extra fields rendered between description and color palette.
        Consumers use this to inject entity-specific controls (e.g. the
        Collection form's group picker) without subclassing the whole modal. */
    extraFields?: Snippet;
    /** Additional validity signal from the consumer. ANDed with the local
        name-trimmed check — the submit button is only enabled when both the
        base check and the consumer's gate pass. Defaults to `true` so
        forms without extra fields behave as before. */
    canSubmit?: boolean;
  } = $props();

  const submitDisabled = $derived(!name.trim() || !canSubmit);

  let confirmingDelete = $state(false);

  const displayTitle = $derived(title ?? (isEdit ? `Edit ${entityName}` : `New ${entityName}`));

  /**
   * Escape drops out of the inline delete-confirm step first, then closes the
   * modal. Matches the layered-overlay behaviour elsewhere in the app (e.g.
   * AddEntryModal's collection picker): Escape always peels the top-most
   * layer, never skips a step.
   */
  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (confirmingDelete) {
      confirmingDelete = false;
      return;
    }
    onclose();
  }
</script>

<svelte:window onkeydown={handleEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose}>
  <div class="modal" role="dialog" aria-modal="true" style="max-width: {maxWidth}" onclick={(e) => e.stopPropagation()}>
    <h2>{displayTitle}</h2>

    <form onsubmit={(e) => { e.preventDefault(); handleFormSubmit(); }}>
      <label class="field">
        <span class="label">Name</span>
        <input use:autofocus type="text" bind:value={name} placeholder={namePlaceholder} required />
      </label>

      {#if showDescription}
        <label class="field">
          <span class="label">Description <span class="optional">(optional)</span></span>
          <textarea bind:value={description} placeholder={descriptionPlaceholder} rows="2"></textarea>
        </label>
      {/if}

      {#if extraFields}
        {@render extraFields()}
      {/if}

      <fieldset class="field">
        <span class="label">Color</span>
        <div class="color-palette">
          {#each PRESET_COLORS as c}
            <button
              type="button"
              class="color-swatch"
              class:selected={color === c}
              style="background: {c}"
              onclick={() => color = c}
              aria-label="Color {c}"
            ></button>
          {/each}
        </div>
      </fieldset>

      <div class="actions">
        {#if isEdit && ondelete}
          {#if confirmingDelete}
            <span class="delete-confirm-text">Delete this {entityName.toLowerCase()}?</span>
            <button type="button" class="btn-delete-confirm" onclick={ondelete}>Delete</button>
            <button type="button" class="btn-cancel" onclick={() => confirmingDelete = false}>Cancel</button>
          {:else}
            <button type="button" class="btn-delete" onclick={() => confirmingDelete = true}>Delete</button>
            <div class="actions-spacer"></div>
            <button type="button" class="btn-cancel" onclick={onclose}>Cancel</button>
            <button type="submit" class="btn-save" disabled={submitDisabled}>Save</button>
          {/if}
        {:else}
          <button type="button" class="btn-cancel" onclick={onclose}>Cancel</button>
          <button type="submit" class="btn-save" disabled={submitDisabled}>
            {isEdit ? 'Save' : 'Create'}
          </button>
        {/if}
      </div>
    </form>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--overlay);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 3rem 1rem;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    padding: 1.5rem;
    margin-left: auto;
    margin-right: auto;
  }

  @media (max-width: 600px), (display-mode: standalone) {
    .overlay {
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
      background: var(--bg);
    }

    .modal {
      max-width: none;
      min-height: 100%;
      border: none;
      border-radius: 0;
    }
  }

  h2 {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .field {
    display: block;
    margin-bottom: 0.85rem;
    border: none;
    padding: 0;
  }

  .label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.3rem;
  }

  .optional {
    text-transform: none;
    font-weight: 400;
  }

  input, textarea {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    padding: 0.5rem 0.65rem;
    font-size: 0.9rem;
    font-family: inherit;
    resize: vertical;
  }

  input:focus, textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .color-palette {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .color-swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: border-color 150ms, transform 150ms;
  }

  .color-swatch:hover {
    transform: scale(1.15);
  }

  .color-swatch.selected {
    border-color: var(--text);
    box-shadow: 0 0 0 2px var(--bg);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.25rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  .btn-cancel {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .btn-cancel:hover {
    border-color: var(--text-muted);
  }

  .btn-save {
    background: var(--accent);
    border: none;
    color: white;
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-save:hover {
    opacity: 0.9;
  }

  .btn-save:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn-delete {
    background: none;
    border: 1px solid var(--danger, #ef4444);
    color: var(--danger, #ef4444);
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .btn-delete:hover {
    background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent 88%);
  }

  .btn-delete-confirm {
    background: var(--danger, #ef4444);
    border: none;
    color: white;
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-delete-confirm:hover {
    background: var(--danger-hover, #dc2626);
  }

  .delete-confirm-text {
    font-size: 0.85rem;
    color: var(--danger, #ef4444);
    margin-right: auto;
  }

  .actions-spacer {
    flex: 1;
  }
</style>
