<!-- packages/web/src/components/Toast.svelte -->
<script lang="ts">
  import { dismissToast, toast } from '../lib/toast';
</script>

{#if $toast}
  <div class="toast" role="status" aria-live="polite">
    <span class="msg">{$toast.message}</span>
    {#if $toast.action}
      <button
        class="action"
        type="button"
        onclick={() => { $toast?.action?.run(); dismissToast(); }}
      >{$toast.action.label}</button>
    {/if}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(1.25rem + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    max-width: min(92vw, 30rem);
    padding: 0.7rem 0.9rem 0.7rem 1.1rem;
    border-radius: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: 0 10px 30px -10px var(--shadow);
    color: var(--text);
    font-size: 0.9rem;
  }
  .msg { min-width: 0; }
  .action {
    flex-shrink: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    padding: 0.1rem 0.3rem;
  }
  .action:hover { color: var(--accent-hover); }
</style>
