<script lang="ts">
  import type { BookmarkItem } from '@inbox-rs/rs-module';
  import { blobUrls, connected, loadFileBlobUrl } from '../lib/stores';
  import Lightbox from './Lightbox.svelte';

  let { item }: { item: BookmarkItem } = $props();
  let showLightbox = $state(false);

  function getDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  const faviconSrc = $derived(
    item.favicon || (() => {
      try { return new URL('/favicon.ico', new URL(item.url).origin).href; }
      catch { return ''; }
    })()
  );

  const imageSrc = $derived(
    (item.filePath ? ($blobUrls[item.filePath] || null) : null) || item.ogImage || null
  );

  // Load from the remote when connected, otherwise the local cache, so
  // offline-captured files still render. Pass mimeType so the blob is tagged
  // with the clean type from item metadata rather than the server's
  // Content-Type (which on 5apps carries the `; charset=binary` suffix that
  // Chrome won't render as <img>). Referencing `$connected` retries over the
  // network once a connection is established.
  $effect(() => {
    void $connected;
    if (item.filePath) loadFileBlobUrl(item.filePath, item.mimeType);
  });
</script>

<div class="bookmark">
  {#if imageSrc}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="og-link" onclick={(e) => { e.stopPropagation(); showLightbox = true; }}>
      <img
        class="og-image"
        src={imageSrc}
        alt=""
        onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'}
      />
    </div>
  {/if}
  {#if showLightbox && imageSrc}
    <Lightbox src={imageSrc} alt={item.title} onclose={() => showLightbox = false} filePath={item.filePath} mimeType={item.mimeType} filename={item.title || undefined} />
  {/if}
  <div class="bookmark-body">
    <div class="bookmark-header">
      {#if faviconSrc}
        <img
          class="favicon"
          src={faviconSrc}
          alt=""
          width="16"
          height="16"
          onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'}
        />
      {/if}
      <span class="domain">{item.siteName || getDomain(item.url)}</span>
    </div>
    <h3 class="title">
      <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}<svg aria-hidden="true" class="link-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>
    </h3>
  </div>
</div>

<style>
  .bookmark {
    display: flex;
    flex-direction: column;
  }

  .og-link {
    display: block;
    margin: -1rem -1rem 0.75rem -1rem;
    cursor: zoom-in;
  }

  .og-image {
    width: 100%;
    display: block;
    object-fit: cover;
    max-height: 180px;
  }

  .bookmark-body {
    display: flex;
    flex-direction: column;
  }

  .bookmark-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  .favicon {
    border-radius: 2px;
    flex-shrink: 0;
  }

  .domain {
    font-size: 0.8rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.3;
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
