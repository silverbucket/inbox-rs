<script lang="ts">
  import type { Collection } from '@inbox-rs/rs-module';

  let { collection = undefined, onclose, onsave }: {
    collection?: Collection;
    onclose: () => void;
    onsave: (col: Collection) => void;
  } = $props();

  const isEdit = !!collection;

  let name = $state(collection?.name ?? '');
  let description = $state(collection?.description ?? '');
  let color = $state(collection?.color ?? '#6366f1');

  const presetColors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
    '#f97316', '#eab308', '#22c55e', '#06b6d4',
  ];

  function handleSubmit() {
    if (!name.trim()) return;
    const col: Collection = {
      id: collection?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || undefined,
      itemIds: collection?.itemIds ?? [],
      createdAt: collection?.createdAt ?? new Date().toISOString(),
      color,
    };
    onsave(col);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose}>
  <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <h2>{isEdit ? 'Edit Collection' : 'New Collection'}</h2>

    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      <label class="field">
        <span class="label">Name</span>
        <input type="text" bind:value={name} placeholder="e.g. Sockethub Bugs" required />
      </label>

      <label class="field">
        <span class="label">Description <span class="optional">(optional)</span></span>
        <textarea bind:value={description} placeholder="What's this collection for?" rows="2"></textarea>
      </label>

      <fieldset class="field">
        <span class="label">Color</span>
        <div class="color-palette">
          {#each presetColors as c}
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
        <button type="button" class="btn-cancel" onclick={onclose}>Cancel</button>
        <button type="submit" class="btn-save" disabled={!name.trim()}>
          {isEdit ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    max-width: 440px;
    padding: 1.5rem;
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
</style>
