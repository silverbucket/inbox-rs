<script lang="ts">
  import { inview } from '../lib/actions';
  import type { ImageItem } from '@inbox-rs/rs-module';
  import { blobUrls, connected, loadFileBlobUrl } from '../lib/stores';
  import Lightbox from './Lightbox.svelte';

  let { item }: { item: ImageItem } = $props();
  let showLightbox = $state(false);
  // Only start fetching bytes once the card approaches the viewport (see the
  // inview action) — otherwise opening a large inbox fires a fetch for every
  // image at once.
  let entered = $state(false);

  // Grid cards prefer the downscaled thumbnail; the Lightbox always gets the
  // original. Items captured by clients that don't generate thumbnails have
  // no thumbPath and fall back to the full file.
  const displayPath = $derived(item.thumbPath || item.filePath);
  const displayMime = $derived(
    item.thumbPath ? item.thumbMimeType : item.mimeType,
  );
  const imageSrc = $derived($blobUrls[displayPath] || null);
  // Lightbox shows the original at full resolution — kick off its load when
  // opened and show the thumbnail as a progressive placeholder until the
  // original's blob URL lands.
  const fullSrc = $derived($blobUrls[item.filePath] || imageSrc);

  // Load the image bytes once visible. loadFileBlobUrl reads the local cache
  // first (file paths are immutable) and falls back to the remote, so files
  // captured while offline still render. Pass mimeType so the blob is tagged
  // as `image/jpeg` rather than whatever the server echoes back (e.g.
  // `image/jpeg; charset=binary` on 5apps, which Chrome refuses to render).
  // Referencing `$connected` re-runs this so we retry over the network once a
  // connection is established. Reading `$blobUrls[displayPath]` also re-runs it
  // when the LRU cache evicts this path (blobUrls entry deleted), so a card
  // that scrolled out and lost its blob reloads instead of going blank — the
  // `inview` observer is one-shot, so `entered` alone never fires again.
  $effect(() => {
    void $connected;
    if (entered && displayPath && !$blobUrls[displayPath]) {
      loadFileBlobUrl(displayPath, displayMime);
    }
  });

  // Lightbox needs the original; re-fetch if it was never loaded or got
  // evicted (guard on `$blobUrls[item.filePath]` for the same eviction reason).
  $effect(() => {
    if (showLightbox && item.filePath && !$blobUrls[item.filePath]) {
      loadFileBlobUrl(item.filePath, item.mimeType);
    }
  });
</script>

<div class="image-card">
  {#if item.title}
    <h3 class="title">{item.title}</h3>
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="image-wrapper" use:inview={() => { entered = true; }} onclick={(e) => { e.stopPropagation(); if (imageSrc) showLightbox = true; }}>
    {#if imageSrc}
      <img
        src={imageSrc}
        alt={item.title || 'Image'}
        loading="lazy"
        decoding="async"
        onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    {:else}
      <div class="placeholder">Not connected</div>
    {/if}
  </div>
  {#if showLightbox && imageSrc}
    <Lightbox src={fullSrc || imageSrc} alt={item.title || 'Image'} onclose={() => showLightbox = false} filePath={item.filePath} mimeType={item.mimeType} filename={item.title || undefined} />
  {/if}
  {#if item.sourceUrl}
    <a class="source-link" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
      Original source
    </a>
  {/if}
</div>

<style>
  .title {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .image-wrapper {
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg);
    cursor: zoom-in;
  }

  img {
    width: 100%;
    display: block;
  }

  .source-link {
    display: block;
    margin-top: 0.4rem;
    font-size: 0.75rem;
    color: var(--accent);
    opacity: 0.7;
  }

  .source-link:hover {
    opacity: 1;
  }

  .placeholder {
    min-height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 0.8rem;
  }
</style>
