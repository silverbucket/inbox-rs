<script lang="ts">
  let { onclick }: { onclick: () => void } = $props();
</script>

<button
  type="button"
  class="help-trigger"
  aria-label="Keyboard shortcuts"
  title="Keyboard shortcuts (?)"
  {onclick}
>
  <span aria-hidden="true">?</span>
</button>

<style>
  .help-trigger {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
  }

  .help-trigger:hover {
    border-color: var(--accent);
    background: var(--accent-subtler);
    color: var(--text);
  }

  .help-trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (max-width: 600px) {
    .help-trigger { display: none; }
  }
</style>
