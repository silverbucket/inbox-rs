<script lang="ts">
  // A small fixed corner badge marking non-production (staging) builds.
  // Renders nothing in production: __STAGING__ is a build-time constant
  // (see vite.config.ts), so this whole block is dead-code-eliminated there.
</script>

{#if __STAGING__}
  <div class="staging-badge" role="status" aria-label="Staging build">
    STAGING
  </div>
{/if}

<style>
  .staging-badge {
    position: fixed;
    bottom: 0.5rem;
    left: 0.5rem;
    z-index: 2147483647;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: #b45309;
    color: #fff;
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    line-height: 1.4;
    /* Purely informational — never intercept clicks on the UI beneath it. */
    pointer-events: none;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
</style>
