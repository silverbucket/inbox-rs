<script lang="ts">
  import type { TodoItem } from '@inbox-rs/rs-module';

  let { item, titleId }: { item: TodoItem; titleId: string } = $props();
</script>

<h2 class="title" id={titleId}>{item.title}</h2>

{#if item.body}
  <div class="content-block">
    <span class="content-label">Body</span>
    <p class="content-text">{item.body}</p>
  </div>
{/if}
