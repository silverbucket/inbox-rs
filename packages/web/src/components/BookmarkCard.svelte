<script lang="ts">
  import { inview } from '../lib/actions';
  import type { BookmarkItem } from '@inbox-rs/rs-module';
  import { blobUrls, connected, loadFileBlobUrl } from '../lib/stores';
  import Lightbox from './Lightbox.svelte';

  let { item }: { item: BookmarkItem } = $props();
  let showLightbox = $state(false);
  // Fetch bytes only once the card approaches the viewport.
  let entered = $state(false);

  const imageSrc = $derived(
    (item.filePath ? ($blobUrls[item.filePath] || null) : null) || item.ogImage || null
  );

  // Load from the remote when connected, otherwise the local cache, so
  // offline-captured files still render. Pass mimeType so the blob is tagged
  // with the clean type from item metadata rather than the server's
  // Content-Type (which on 5apps carries the `; charset=binary` suffix that
  // Chrome won't render as <img>). Referencing `$connected` retries over the
  // network once a connection is established; reading `$blobUrls[item.filePath]`
  // re-runs it when the LRU cache evicts this path, so an evicted card reloads
  // on scroll-back instead of going blank (the `inview` observer is one-shot,
  // so `entered` alone never fires again).
  $effect(() => {
    void $connected;
    if (entered && item.filePath && !$blobUrls[item.filePath]) {
      loadFileBlobUrl(item.filePath, item.mimeType);
    }
  });
</script>

<div class="bookmark" use:inview={() => { entered = true; }}>
  {#if imageSrc}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="og-link" onclick={(e) => { e.stopPropagation(); showLightbox = true; }}>
      <img
        class="og-image"
        src={imageSrc}
        alt=""
        loading="lazy"
        decoding="async"
        onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'}
      />
    </div>
  {/if}
  {#if showLightbox && imageSrc}
    <Lightbox src={imageSrc} alt={item.title} onclose={() => showLightbox = false} filePath={item.filePath} mimeType={item.mimeType} filename={item.title || undefined} />
  {/if}
  <h3 class="title">
    <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}<svg aria-hidden="true" class="link-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>
  </h3>
</div>

<style>
  .bookmark {
    display: flex;
    flex-direction: column;
  }

  /* Full-bleed to the card's side/bottom edges; the kind row sits above it. */
  .og-link {
    display: block;
    margin: 0 -1.1rem 0.75rem;
    cursor: zoom-in;
  }

  .og-image {
    width: 100%;
    display: block;
    object-fit: cover;
    max-height: 180px;
  }

  .title {
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.3;
    word-break: break-word;
  }

  .title a {
    color: var(--text);
    transition: color 0.15s;
  }

  .title a:hover {
    color: var(--accent);
  }

  .title :global(.link-icon) {
    display: inline;
    vertical-align: middle;
    margin-left: 0.3rem;
    opacity: 0.5;
  }

  .title a:hover :global(.link-icon) {
    opacity: 1;
  }
</style>
