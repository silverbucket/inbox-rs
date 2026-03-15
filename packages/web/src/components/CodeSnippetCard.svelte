<script lang="ts">
  import type { CodeSnippetItem } from '@inbox-rs/rs-module';

  let { item }: { item: CodeSnippetItem } = $props();
</script>

<div class="code-snippet">
  <div class="header">
    <h3 class="title">{item.title}</h3>
    {#if item.language}
      <span class="language-badge">{item.language}</span>
    {/if}
  </div>
</div>

<style>
  .header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }

  .title {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .language-badge {
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent);
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 500;
    text-transform: lowercase;
  }


</style>
