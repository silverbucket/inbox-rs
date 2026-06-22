<script lang="ts">
  import type { BookmarkItem } from '@inbox-rs/rs-module';
  import { blobUrls, connected, loadFileBlobUrl } from '../../lib/stores';
  import Lightbox from '../Lightbox.svelte';

  let { item, titleId }: { item: BookmarkItem; titleId: string } = $props();

  let showLightbox = $state(false);

  function getDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  // Prefer the locally-stored copy of the OG image when we have it (fetched
  // via Authorization header so it works on all RS servers); otherwise fall
  // back to the live ogImage URL the bookmark was originally tagged with.
  const imageSrc = $derived(
    (item.filePath ? ($blobUrls[item.filePath] || null) : null) ||
      item.ogImage ||
      null,
  );

  // Pass mimeType so the blob is tagged with the clean type from item
  // metadata rather than the server's Content-Type — 5apps preserves the
  // `; charset=binary` suffix that wireclient adds on upload, and Chrome
  // won't render an <img> whose Blob type carries that suffix.
  $effect(() => {
    // Load from the remote when connected, otherwise the local cache, so
    // offline-captured files still render; retries on reconnect.
    void $connected;
    if (item.filePath) loadFileBlobUrl(item.filePath, item.mimeType);
  });
</script>

<h2 class="title" id={titleId}>
  <a href={item.url} target="_blank" rel="noopener noreferrer"
    >{item.title}<svg
      aria-hidden="true"
      class="link-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
      ></path><polyline points="15 3 21 3 21 9"></polyline><line
        x1="10"
        y1="14"
        x2="21"
        y2="3"
      ></line></svg
    ></a
  >
</h2>

<div class="meta-row">
  {#if item.favicon}
    <img
      class="favicon"
      src={item.favicon}
      alt=""
      width="16"
      height="16"
      onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
    />
  {/if}
  <span class="domain">{item.siteName || getDomain(item.url)}</span>
</div>

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

<!--
  Embedded body content captured by the extension (tweet text, article
  excerpt, etc.). We render it after the image so the bookmark's primary
  visual cue stays at the top, but before description so the user-supplied
  caption (if any) reads as a follow-up to the captured content.
-->
{#if item.body}
  <div class="content-block">
    <span class="content-label">Body</span>
    <p class="content-text">{item.body}</p>
  </div>
{/if}
