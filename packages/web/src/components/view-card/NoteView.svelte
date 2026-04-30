<script lang="ts">
  import type { NoteItem } from '@inbox-rs/rs-module';
  import 'highlight.js/styles/github-dark.min.css';
  import { renderMarkdown } from '../../lib/markdown';

  let { item, titleId }: { item: NoteItem; titleId: string } = $props();

  let renderedBody = $state('');

  // Re-render markdown whenever the note body changes. The id check guards
  // against a late async render from a previous note overwriting the
  // current one (the parent may swap the item under us as the user
  // navigates between cards).
  $effect(() => {
    const currentItem = item;
    renderedBody = '';
    if (!currentItem.body) return;
    renderMarkdown(currentItem.body).then((html) => {
      if (item.id === currentItem.id) renderedBody = html;
    });
  });
</script>

<h2 class="title" id={titleId}>{item.title}</h2>

{#if item.body}
  <div class="content-block">
    <span class="content-label">Body</span>
    {#if renderedBody}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="markdown-body">{@html renderedBody}</div>
    {:else}
      <p class="content-text">{item.body}</p>
    {/if}
  </div>
{/if}
