<script lang="ts">
  /**
   * A small dialog shell for the board screens: overlay, focus trap,
   * Escape and backdrop to close. `layer` lifts it above Settings (300)
   * when opened from there.
   */
  import type { Snippet } from 'svelte';
  import { trapFocus } from '../../lib/actions';

  let {
    title,
    onclose,
    layer = 220,
    width = '30rem',
    children,
    footer,
  }: {
    title: string;
    onclose: () => void;
    layer?: number;
    width?: string;
    children: Snippet;
    footer?: Snippet;
  } = $props();

  const titleId = `sheet-${Math.random().toString(36).slice(2, 9)}`;

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    onclose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" style="z-index: {layer}" onclick={onclose}>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    style="--sheet-w: {width}"
    use:trapFocus
    onclick={(e) => e.stopPropagation()}
    {onkeydown}
  >
    <header class="head">
      <h2 id={titleId}>{title}</h2>
      <button type="button" class="close" aria-label="Close" onclick={onclose}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer class="foot">{@render footer()}</footer>{/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 6vh 1rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--overlay);
  }

  .sheet {
    width: 100%;
    max-width: var(--sheet-w);
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 1.1rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 16px 48px var(--shadow);
  }

  .sheet:focus {
    outline: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .head h2 {
    flex: 1;
    margin: 0;
    font-size: 1.05rem;
  }

  .close {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .close:hover {
    background: var(--surface-tint);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  @media (max-width: 600px) {
    .overlay {
      padding: 0;
      align-items: flex-end;
    }

    .sheet {
      max-width: none;
      border-radius: var(--radius) var(--radius) 0 0;
      max-height: 92vh;
      overflow-y: auto;
    }
  }
</style>
