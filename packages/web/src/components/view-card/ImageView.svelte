<script lang="ts">
  import type { ImageItem } from '@inbox-rs/rs-module';
  import { blobUrls, connected, loadFileBlobUrl } from '../../lib/stores';
  import Lightbox from '../Lightbox.svelte';

  let { item, titleId, showTitle = true }: { item: ImageItem; titleId: string; showTitle?: boolean } = $props();

  let showLightbox = $state(false);
  let failedImageSrc = $state<string | null>(null);

  const imageSrc = $derived(
    (item.filePath && $blobUrls[item.filePath] !== failedImageSrc
      ? $blobUrls[item.filePath]
      : null) ||
      (item.sourceUrl !== failedImageSrc ? item.sourceUrl : null) ||
      null,
  );

  // The parent shell wraps the per-type view in `{#key item.id}`, so
  // navigating between images remounts this component — `showLightbox`
  // initialises fresh without an explicit reset effect.

  // Pass mimeType so the blob is tagged with the clean type from item
  // metadata; see BookmarkView for the longer note.
  $effect(() => {
    // Load from the remote when connected, otherwise the local cache, so
    // offline-captured files still render; retries on reconnect.
    void $connected;
    if (item.filePath) loadFileBlobUrl(item.filePath, item.mimeType);
  });
</script>

{#if showTitle}<h2 class="title" id={titleId}>{item.title}</h2>{/if}

{#if imageSrc}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="view-image-link" onclick={() => (showLightbox = true)}>
    <img
      class="view-image"
      src={imageSrc}
      alt=""
      onerror={() => (failedImageSrc = imageSrc)}
    />
  </div>
{/if}
{#if failedImageSrc === item.sourceUrl}
  <p class="status-text">Preview blocked by source</p>
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
