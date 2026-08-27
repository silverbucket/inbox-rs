<script lang="ts">
  import type { ImageItem } from '@inbox-rs/rs-module';
  import ImageCard from './ImageCard.svelte';

  let { initialItem }: { initialItem: ImageItem } = $props();

  export function updateSourceUrl(sourceUrl: string) {
    initialItem = { ...initialItem, sourceUrl };
  }
</script>

<ImageCard item={initialItem} />
