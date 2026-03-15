<script lang="ts">
  import type { NoteItem } from '@inbox-rs/rs-module';

  let { item }: { item: NoteItem } = $props();
</script>

<div class="note">
  <h3 class="title">{item.title}</h3>
</div>

<style>
  .title {
    font-size: 0.95rem;
    font-weight: 600;
  }
</style>
