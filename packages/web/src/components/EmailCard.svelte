<script lang="ts">
  import type { EmailItem } from '@inbox-rs/rs-module';

  let { item }: { item: EmailItem } = $props();
</script>

<div class="email">
  <h3 class="title">
    {#if item.messageUrl}
      <a href={item.messageUrl}>{item.title}<svg aria-hidden="true" class="link-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>
    {:else}
      {item.title}
    {/if}
  </h3>
  {#if item.from}
    <p class="from">From: {item.from}</p>
  {/if}
</div>

<style>
  .title {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.4rem;
  }

  .title a {
    color: var(--text);
    transition: color 0.15s;
  }

  .title a:hover {
    color: var(--accent);
  }

  .title :global(.link-icon) {
    display: inline;
    vertical-align: middle;
    margin-left: 0.3rem;
    opacity: 0.5;
  }

  .title a:hover :global(.link-icon) {
    opacity: 1;
  }

  .from {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
</style>
