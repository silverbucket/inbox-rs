<script lang="ts">
  import type { AudioItem } from '@inbox-rs/rs-module';
  import { blobUrls, connected, loadFileBlobUrl } from '../lib/stores';

  let { item }: { item: AudioItem } = $props();
  let audioEl = $state<HTMLAudioElement | null>(null);
  let playing = $state(false);

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

  // Decorative waveform bars derived deterministically from the item id, so
  // each memo gets its own stable silhouette (a real PCM analysis would be
  // overkill for a preview). 28 bars, 5–26px tall.
  const bars = $derived.by(() => {
    let h = 2166136261;
    for (let i = 0; i < item.id.length; i++) {
      h = Math.imul(h ^ item.id.charCodeAt(i), 16777619) >>> 0;
    }
    const out: number[] = [];
    for (let i = 0; i < 28; i++) {
      h = (Math.imul(h, 1103515245) + 12345) >>> 0;
      out.push(5 + (h % 22));
    }
    return out;
  });

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    if (!audioEl) return;
    if (playing) audioEl.pause();
    else void audioEl.play();
  }

  function formatDuration(seconds?: number): string {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

<div class="audio">
  <h3 class="title">{item.title || 'Voice memo'}</h3>
  <div class="voice">
    <button
      class="play"
      class:playing
      type="button"
      onclick={toggle}
      disabled={!audioSrc}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      {#if playing}
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
      {/if}
    </button>
    <div class="wave" aria-hidden="true">
      {#each bars as h, i (i)}
        <span style="height:{h}px"></span>
      {/each}
    </div>
    {#if item.duration}
      <span class="dur">{formatDuration(item.duration)}</span>
    {/if}
  </div>
  {#if audioSrc}
    <!-- Hidden player driven by the waveform button. Real playback + transcript
         live in the view modal; the empty track satisfies the lint rule. -->
    <audio
      bind:this={audioEl}
      src={audioSrc}
      preload="none"
      onplay={() => (playing = true)}
      onpause={() => (playing = false)}
      onended={() => (playing = false)}
    >
      <track kind="captions" />
    </audio>
  {/if}
</div>

<style>
  .title {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .voice {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.25rem;
  }

  .play {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: none;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-subtle);
    color: var(--accent);
    cursor: pointer;
    transition: background 150ms ease, transform 120ms ease;
  }

  .play:hover:not(:disabled) {
    background: var(--accent-subtle-strong);
  }

  .play:active:not(:disabled) {
    transform: scale(0.94);
  }

  .play:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .play svg {
    width: 16px;
    height: 16px;
  }

  .wave {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 26px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .wave span {
    flex: 1;
    min-width: 2px;
    max-width: 3px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--accent) 32%, var(--border));
  }

  .play.playing + .wave span {
    background: color-mix(in srgb, var(--accent) 55%, var(--border));
  }

  .dur {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
</style>
