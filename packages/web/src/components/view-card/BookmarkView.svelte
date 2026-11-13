<script lang="ts">
  import type { BookmarkItem } from '@inbox-rs/rs-module';
  import { convertBookmarkToImage } from '../../lib/bookmark-image';
  import {
    describeLinkPreviewError,
    LINK_PREVIEW_ERROR,
    needsEnrichment,
    refreshBookmark,
    replaceBookmarkImage,
  } from '../../lib/enrich';
  import {
    blobUrls,
    connected,
    loadFileBlobUrl,
    userSettings,
  } from '../../lib/stores';
  import { liveItemLinks } from '../../lib/item-link-live';
  import { renderMarkdown } from '../../lib/markdown';
  import Lightbox from '../Lightbox.svelte';

  let {
    item,
    titleId,
    showTitle = true,
    beforeAction = async () => {},
  }: {
    item: BookmarkItem;
    titleId: string;
    showTitle?: boolean;
    beforeAction?: () => Promise<void>;
  } = $props();

  let showLightbox = $state(false);
  let fetchingPreview = $state(false);
  let previewStatus = $state<'' | 'none' | 'current' | 'offline'>('');
  let previewError = $state('');
  // A different image the page now has. Shown beside the saved one for the
  // user to pick: the saved image may be the only copy of a page that has
  // since changed or died, so a re-fetch never replaces it on its own.
  let imageOffer = $state('');
  let applyingImage = $state(false);
  let renderedBody = $state('');

  $effect(() => {
    const currentItem = item;
    const currentBody = currentItem.body;
    renderedBody = '';
    if (!currentBody) return;
    renderMarkdown(currentBody).then((html) => {
      if (item.id === currentItem.id && item.body === currentBody) {
        renderedBody = html;
      }
    });
  });

  // Fetch the page's metadata on demand: to fill what is missing, or to
  // check a preview that looks complete but is wrong. Mirrors AudioView's
  // transcribe flow — the parent's `{#key item.id}` remount makes state
  // resets and stale-promise guards unnecessary.
  async function handleFetchPreview() {
    try {
      await beforeAction();
    } catch {
      return;
    }
    if (!navigator.onLine) {
      previewStatus = 'offline';
      return;
    }
    const incomplete = needsEnrichment(item);
    fetchingPreview = true;
    previewStatus = '';
    previewError = '';
    imageOffer = '';
    try {
      if (await convertBookmarkToImage(item)) return;
      const result = await refreshBookmark(item);
      imageOffer = result.image ?? '';
      // The enriched fields flow back reactively through the items store;
      // only "nothing new" needs an explicit signal.
      if (result.status === 'skipped') {
        previewStatus = 'none';
      } else if (result.status === 'none' && !imageOffer) {
        previewStatus = incomplete ? 'none' : 'current';
      }
    } catch (e) {
      console.warn('Metadata fetch failed:', e);
      previewError = describeLinkPreviewError(e);
    } finally {
      fetchingPreview = false;
    }
  }

  // An offer belongs to the link it was fetched for: editing the URL in
  // this same card must not let it land on a different page's bookmark.
  // Derived, so that saving other fields of the same link keeps the offer.
  const offerUrl = $derived(item.url);
  $effect(() => {
    void offerUrl;
    imageOffer = '';
  });

  async function useOfferedImage() {
    applyingImage = true;
    try {
      await replaceBookmarkImage(item, imageOffer);
      imageOffer = '';
    } catch (e) {
      console.warn('Replacing the preview image failed:', e);
      previewError = describeLinkPreviewError(e);
    } finally {
      applyingImage = false;
    }
  }

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
  const savedSrc = $derived(
    (item.filePath ? ($blobUrls[item.filePath] || null) : null) ||
      item.ogImage ||
      null,
  );
  // The image that failed to load, if any. Remembered by source rather than
  // by hiding the element, which would keep a replacement hidden too.
  let failedSrc = $state('');
  const imageSrc = $derived(savedSrc === failedSrc ? null : savedSrc);

  // Pass mimeType so the blob is tagged with the clean type from item
  // metadata rather than the server's Content-Type. Older uploads may still
  // carry a `; charset=binary` suffix that the server echoes back, and Chrome
  // won't render an <img> whose Blob type carries that suffix.
  $effect(() => {
    // Load from the remote when connected, otherwise the local cache, so
    // offline-captured files still render; retries on reconnect.
    void $connected;
    if (item.filePath) loadFileBlobUrl(item.filePath, item.mimeType);
  });
</script>

<section class="bookmark-preview" aria-label="Link preview">
{#if showTitle}
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
{/if}

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
  {#if fetchingPreview}
    <span class="status-text">Fetching preview…</span>
  {:else if previewError}
    <span class="status-text error-text">{LINK_PREVIEW_ERROR}</span>
    <button type="button" class="btn-action" onclick={handleFetchPreview}
      >Retry</button
    >
    <details class="error-details">
      <summary>More details</summary>
      <p>{previewError}</p>
    </details>
  {:else}
    {#if previewStatus === 'none'}
      <span class="status-text">No preview available</span>
    {:else if previewStatus === 'current'}
      <span class="status-text">Preview is up to date</span>
    {:else if previewStatus === 'offline'}
      <span class="status-text">You’re offline — try again when connected</span>
    {/if}
    <!-- While the image choice below is open, it is the only control. The
         outcome of a fetch never takes the button away: the page may have
         changed again, or the connection come back. -->
    {#if imageOffer || $userSettings.linkPreviews === false}
      <!-- nothing to offer -->
    {:else if needsEnrichment(item) && !previewStatus}
      <button type="button" class="btn-action" onclick={handleFetchPreview}
        >Fetch preview</button
      >
    {:else}
      <button type="button" class="btn-link refresh-preview" onclick={handleFetchPreview}
        >Refresh preview</button
      >
    {/if}
  {/if}
</div>

{#if imageOffer}
  <div class="image-offer" role="group" aria-label="Choose the preview image">
    <p class="offer-text">
      The page has a different image. Yours stays unless you switch.
    </p>
    <div class="offer-choices">
      <figure>
        {#if imageSrc}
          <img src={imageSrc} alt="Saved preview" />
        {/if}
        <figcaption>Saved</figcaption>
      </figure>
      <figure>
        <!-- An image that will not load is not worth offering. -->
        <img
          src={imageOffer}
          alt="Preview from the page"
          onerror={() => {
            imageOffer = '';
            previewStatus = 'current';
          }}
        />
        <figcaption>From the page</figcaption>
      </figure>
    </div>
    <div class="offer-actions">
      <button
        type="button"
        class="btn-action"
        disabled={applyingImage}
        onclick={() => (imageOffer = '')}>Keep saved image</button
      >
      <button
        type="button"
        class="btn-action"
        disabled={applyingImage}
        onclick={useOfferedImage}>Use new image</button
      >
    </div>
  </div>
{:else if imageSrc}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="view-image-link" onclick={() => (showLightbox = true)}>
    <img
      class="view-image"
      src={imageSrc}
      alt=""
      onerror={() => (failedSrc = imageSrc ?? '')}
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

{#if item.body}
  <div class="content-block">
    <span class="content-label">Notes</span>
    {#if renderedBody}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="markdown-body" use:liveItemLinks>{@html renderedBody}</div>
    {:else}
      <p class="content-text">{item.body}</p>
    {/if}
  </div>
{/if}
</section>

<style>
  .bookmark-preview {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .error-text {
    color: var(--danger-text);
  }

  /* Sits at the end of the row: there when wanted, out of the way otherwise. */
  .meta-row .refresh-preview {
    margin: 0 0 0 auto;
  }

  .image-offer {
    margin-bottom: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .offer-text {
    margin: 0 0 0.6rem;
    font-size: 0.85rem;
  }

  .offer-choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  .offer-choices figure {
    display: flex;
    min-width: 0;
    margin: 0;
    flex-direction: column;
    gap: 0.3rem;
  }

  .offer-choices img {
    width: 100%;
    height: 9rem;
    object-fit: contain;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .offer-choices figcaption {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .offer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }

  .image-offer .offer-actions .btn-action {
    margin-bottom: 0;
  }

  /* The details wrap onto their own line under the message. */
  .meta-row:has(.error-details) {
    flex-wrap: wrap;
  }

  .error-details {
    flex-basis: 100%;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .error-details summary {
    cursor: pointer;
  }

  .error-details p {
    margin: 0.25rem 0 0;
  }
</style>
