<script lang="ts">
  import type { AudioItem } from '@inbox-rs/rs-module';
  import { blobUrls, connected, loadFileBlobUrl } from '../lib/stores';

  let { item }: { item: AudioItem } = $props();
  let audioError = $state(false);

  const audioSrc = $derived($blobUrls[item.filePath] || null);

  // Load audio bytes. loadFileBlobUrl fetches from the remote when connected
  // and the local cache otherwise, so files captured via the capture app still
  // play. Pass mimeType so the blob is tagged with the clean type from item
  // metadata rather than whatever the server echoes back (e.g.
  // `audio/webm; charset=binary` on 5apps). Referencing `$connected` re-runs
  // this so we retry over the network once a connection is established.
  $effect(() => {
    void $connected;
    if (item.filePath) loadFileBlobUrl(item.filePath, item.mimeType);
  });

  function formatDuration(seconds?: number): string {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

<div class="audio">
  <h3 class="title">{item.title}</h3>
  {#if item.duration}
    <span class="duration">{formatDuration(item.duration)}</span>
  {/if}
  <div class="player">
    {#if audioError}
      <p class="status">Failed to load audio</p>
    {:else if audioSrc}
      <!-- User-recorded audio has no separate captions track; the
           transcription text (when present) is rendered alongside the player
           in ViewCardModal. The empty <track> just satisfies the lint rule. -->
      <audio
        controls
        src={audioSrc}
        preload="metadata"
        onerror={() => (audioError = true)}
      >
        <track kind="captions" />
      </audio>
    {:else}
      <p class="status">Loading audio...</p>
    {/if}
  </div>
</div>

<style>
  .title {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .duration {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .player {
    margin-top: 0.5rem;
  }

  audio {
    width: 100%;
    height: 36px;
  }

  .status {
    font-size: 0.8rem;
    color: var(--text-muted);
  }


</style>
