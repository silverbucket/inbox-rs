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
  <pre class="code"><code>{item.body}</code></pre>
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

  .code {
    background: var(--bg);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    font-size: 0.8rem;
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 12;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
  }

  code {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    color: var(--text);
  }
</style>
