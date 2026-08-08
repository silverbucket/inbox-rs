<script lang="ts">
  import type { EmailItem } from '@inbox-rs/rs-module';
  import 'highlight.js/styles/github-dark.min.css';
  import { renderMarkdown } from '../../lib/markdown';

  let { item, titleId }: { item: EmailItem; titleId: string } = $props();

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

<h2 class="title" id={titleId}>
  {#if item.messageUrl}
    <a href={item.messageUrl}
      >{item.title}<svg
        aria-hidden="true"
        class="link-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
        ></path><polyline points="15 3 21 3 21 9"></polyline><line
          x1="10"
          y1="14"
          x2="21"
          y2="3"
        ></line></svg
      ></a
    >
  {:else}
    {item.title}
  {/if}
</h2>

{#if item.from}
  <p class="meta-text">From: {item.from}</p>
{/if}

<!-- Notes appear before the body — they're the user's own annotation and
     we want them surfaced first when reviewing what's worth reading. -->
{#if item.notes}
  <div class="content-block notes-block">
    <span class="content-label">Notes</span>
    <p class="content-text">{item.notes}</p>
  </div>
{/if}

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
