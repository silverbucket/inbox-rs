<script lang="ts">
  import type { TodoItem } from '@inbox-rs/rs-module';
  import 'highlight.js/styles/github-dark.min.css';
  import { renderMarkdown } from '../../lib/markdown';

  let { item, titleId }: { item: TodoItem; titleId: string } = $props();

  let renderedBody = $state('');

  $effect(() => {
    const currentItem = item;
    renderedBody = '';
    if (!currentItem.body) return;
    const currentBody = currentItem.body;
    renderMarkdown(currentBody).then((html) => {
      if (item.id === currentItem.id && item.body === currentBody) {
        renderedBody = html;
      }
    });
  });
</script>

<h2 class="title" id={titleId}>{item.title}</h2>

{#if item.body}
  <div class="content-block">
    <span class="content-label">Body</span>
    {#if renderedBody}
      <div class="markdown-body">{@html renderedBody}</div>
    {:else}
      <p class="content-text">{item.body}</p>
    {/if}
  </div>
{/if}
