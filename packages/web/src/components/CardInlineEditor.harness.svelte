<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { untrack } from 'svelte';
  import CardInlineEditor from './CardInlineEditor.svelte';

  let { initial }: { initial: InboxItem } = $props();
  let item = $state(untrack(() => initial));
  let flush = $state(async () => {});

  export function updateItem(next: InboxItem) {
    item = next;
  }

  export async function flushEdits() {
    await flush();
  }
</script>

<CardInlineEditor {item} bind:flush />
