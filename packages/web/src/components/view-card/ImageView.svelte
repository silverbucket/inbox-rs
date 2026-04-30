<script lang="ts">
  import type { ImageItem } from '@inbox-rs/rs-module';
  import { blobUrls, connected, loadFileBlobUrl } from '../../lib/stores';
  import Lightbox from '../Lightbox.svelte';

  let { item, titleId }: { item: ImageItem; titleId: string } = $props();

  let showLightbox = $state(false);

  const imageSrc = $derived($blobUrls[item.filePath] || null);

  // The parent shell wraps the per-type view in `{#key item.id}`, so
  // navigating between images remounts this component — `showLightbox`
  // initialises fresh without an explicit reset effect.

  // Pass mimeType so the blob is tagged with the clean type from item
  // metadata; see BookmarkView for the longer note.
  $effect(() => {
    if (!$connected) return;
    if (item.filePath) loadFileBlobUrl(item.filePath, item.mimeType);
  });
</script>

<h2 class="title" id={titleId}>{item.title}</h2>

{#if imageSrc}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="view-image-link" onclick={() => (showLightbox = true)}>
    <img
      class="view-image"
      src={imageSrc}
      alt=""
      onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
    />
  </div>
{/if}
{#if showLightbox && imageSrc}
  <Lightbox
    src={imageSrc}
    alt={item.title}
    onclose={() => (showLightbox = false)}
    filePath={item.filePath}
    mimeType={item.mimeType}
    filename={item.title || undefined}
  />
{/if}
