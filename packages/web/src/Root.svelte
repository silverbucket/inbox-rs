<script lang="ts">
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';
  import LogoShield from './components/LogoShield.svelte';

  let FullApp = $state<Component | null>(null);
  let failed = $state(false);

  onMount(() => {
    void import('./App.svelte')
      .then((module) => {
        FullApp = module.default;
      })
      .catch((error: unknown) => {
        console.error('Failed to load Inbox RS app', error);
        failed = true;
      });
  });
</script>

{#if FullApp}
  <FullApp />
{:else}
  <main class="startup-shell" aria-busy={!failed}>
    <div class="startup-card">
      <span class="startup-logo" aria-hidden="true"><LogoShield /></span>
      <p class="eyebrow">Inbox RS</p>
      {#if failed}
        <h1>Could not load the app.</h1>
        <p class="muted">Check your connection and reload. If you installed the app, it may need one online launch to refresh its cache.</p>
        <button type="button" onclick={() => window.location.reload()}>Reload</button>
      {:else}
        <h1>Opening your inbox...</h1>
        <p class="muted">Loading local app data first. Sync will continue in the background.</p>
      {/if}
    </div>
  </main>
{/if}

<style>
  .startup-shell {
    min-height: 100vh;
    padding: 1.5rem;
    display: grid;
    place-items: center;
    background:
      radial-gradient(circle at 50% 0, var(--accent-subtle), transparent 26rem),
      var(--bg);
  }

  .startup-card {
    width: min(100%, 28rem);
    padding: 2rem;
    border: 1px solid var(--border);
    border-radius: 1.5rem;
    background: var(--surface);
    text-align: center;
    box-shadow: var(--shadow-lg);
  }

  .startup-logo {
    display: inline-flex;
    height: 4rem;
    margin-bottom: 1rem;
  }

  .startup-logo :global(svg) {
    height: 4rem;
    width: auto;
  }

  .eyebrow {
    margin: 0 0 0.25rem;
    color: var(--accent);
    font-size: 0.8rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    color: var(--text);
    font-size: clamp(1.6rem, 6vw, 2.4rem);
    letter-spacing: -0.05em;
  }

  .muted {
    margin: 0.75rem 0 0;
    color: var(--text-muted);
    line-height: 1.5;
  }

  button {
    margin-top: 1rem;
    min-height: 2.5rem;
    padding: 0 1rem;
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font-size: 1rem;
    font-weight: 800;
    cursor: pointer;
  }
</style>
