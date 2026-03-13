<script lang="ts">
  import type { ImageItem } from '@inbox-rs/rs-module';
  import { getFileUrl } from '../lib/rs';
  import Lightbox from './Lightbox.svelte';

  let { item }: { item: ImageItem } = $props();
  let showLightbox = $state(false);

  const imageSrc = $derived(getFileUrl(item.filePath));
</script>

<div class="image-card">
  {#if item.title}
    <h3 class="title">{item.title}</h3>
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="image-wrapper" onclick={() => { if (imageSrc) showLightbox = true; }}>
    {#if imageSrc}
      <img
        src={imageSrc}
        alt={item.title || 'Image'}
        onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    {:else}
      <div class="placeholder">Not connected</div>
    {/if}
  </div>
  {#if showLightbox && imageSrc}
    <Lightbox src={imageSrc} alt={item.title || 'Image'} onclose={() => showLightbox = false} />
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
