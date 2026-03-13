<script lang="ts">
  import type { NoteItem } from '@inbox-rs/rs-module';

  let { item }: { item: NoteItem } = $props();
</script>

<div class="note">
  <h3 class="title">{item.title}</h3>
  <p class="body">{item.body}</p>
</div>

<style>
  .title {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.4rem;
  }

  .body {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 8;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
