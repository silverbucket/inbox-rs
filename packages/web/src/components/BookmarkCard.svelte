<script lang="ts">
  import type { BookmarkItem } from '@inbox-rs/rs-module';
  import { getFileUrl } from '../lib/rs';
  import Lightbox from './Lightbox.svelte';

  let { item, ondelete }: { item: BookmarkItem; ondelete?: () => void } = $props();
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

  // Direct URL to stored image (uses token in query string), or ogImage URL fallback
  const imageSrc = $derived(
    (item.filePath ? getFileUrl(item.filePath) : null) || item.ogImage || null
  );
</script>

<div class="bookmark">
  {#if imageSrc}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="og-link" onclick={() => showLightbox = true}>
      <img
        class="og-image"
        src={imageSrc}
        alt=""
        onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'}
      />
    </div>
  {/if}
  {#if showLightbox && imageSrc}
    <Lightbox src={imageSrc} alt={item.title} onclose={() => showLightbox = false} filePath={item.filePath} mimeType={item.mimeType} filename={item.title || undefined} {ondelete} />
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
      <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
    </h3>
    {#if item.body}
      <p class="body-text">{item.body}</p>
    {/if}
    {#if item.description}
      <p class="description">{item.description}</p>
    {/if}
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

  .body-text {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--text);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .description {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
