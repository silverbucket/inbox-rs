<script lang="ts">
  import type { AudioItem } from '@inbox-rs/rs-module';
  import 'highlight.js/styles/github-dark.min.css';
  import { renderMarkdown } from '../../lib/markdown';
  import { blobUrls, connected, loadFileBlobUrl, storeItem } from '../../lib/stores';
  import rs from '../../lib/rs';
  import { transcribeAudio } from '../../lib/transcribe';
  import OfflineTranscriptionAssets from '../OfflineTranscriptionAssets.svelte';

  let {
    item,
    titleId,
    showTitle = true,
    showBody = true,
    beforeAction = async () => {},
  }: {
    item: AudioItem;
    titleId: string;
    showTitle?: boolean;
    showBody?: boolean;
    beforeAction?: () => Promise<void>;
  } = $props();

  let audioError = $state(false);
  let transcribing = $state(false);
  let transcriptionError = $state(false);
  let renderedBody = $state('');

  const audioSrc = $derived($blobUrls[item.filePath] || null);

  // The parent shell wraps the per-type view in `{#key item.id}`, so
  // navigating between audios remounts this component — `audioError` and
  // friends initialise fresh without explicit reset effects.

  // Pass mimeType so the blob is tagged with the clean type from item
  // metadata; see BookmarkView for the longer note.
  $effect(() => {
    // Load from the remote when connected, otherwise the local cache, so
    // offline-captured files still render; retries on reconnect.
    void $connected;
    if (item.filePath) loadFileBlobUrl(item.filePath, item.mimeType);
  });

  $effect(() => {
    const currentItem = item;
    renderedBody = '';
    if (!currentItem.body) return;
    const currentBody = currentItem.body;
    renderMarkdown(currentBody).then((html) => {
      if (item.id === currentItem.id && item.body === currentBody) {
        renderedBody = html;
      }
    });
  });

  function formatDuration(seconds?: number): string {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async function handleTranscribe() {
    await beforeAction();
    // The parent's `{#key item.id}` block destroys this component if the
    // user navigates to a different audio mid-transcription, which cancels
    // any UI updates from the in-flight promise — Svelte simply stops
    // applying state writes from a destroyed component. So we don't need
    // an explicit id-guard around the finally block.
    transcribing = true;
    transcriptionError = false;
    try {
      const file = await rs.inbox.getFile(item.filePath);
      if (!file?.data) throw new Error('Could not load audio file');
      const blob = new Blob([file.data], { type: item.mimeType });
      const text = await transcribeAudio(blob);
      const updated: AudioItem = {
        ...item,
        body: text || undefined,
        title: text && item.title === 'Audio' ? text.slice(0, 50) : item.title,
        transcribed: true,
      };
      await storeItem(updated);
    } catch (e) {
      console.warn('Transcription failed:', e);
      transcriptionError = true;
    } finally {
      transcribing = false;
    }
  }
</script>

{#if showTitle}<h2 class="title" id={titleId}>{item.title}</h2>{/if}

<div class="player">
  {#if audioError}
    <p class="status-text">Failed to load audio</p>
  {:else if audioSrc}
    <audio
      controls
      src={audioSrc}
      preload="metadata"
      onerror={() => (audioError = true)}
    >
      <!-- See AudioCard.svelte for why an empty captions track is OK here. -->
      <track kind="captions" />
    </audio>
  {:else}
    <p class="status-text">Connect to load audio</p>
  {/if}
  {#if item.duration}
    <span class="duration">{formatDuration(item.duration)}</span>
  {/if}
  {#if transcribing}
    <p class="status-text">Transcribing...</p>
  {:else if transcriptionError}
    <p class="status-text">Transcription failed</p>
    <button type="button" class="btn-action" onclick={handleTranscribe}
      >Retry</button
    >
  {:else if audioSrc && !item.transcribed && !item.body}
    <button type="button" class="btn-action" onclick={handleTranscribe}
      >Transcribe</button
    >
  {/if}
  <OfflineTranscriptionAssets />
</div>

{#if showBody && item.body}
  <div class="content-block">
    <span class="content-label">Transcription</span>
    {#if renderedBody}
      <div class="markdown-body">{@html renderedBody}</div>
    {:else}
      <p class="content-text">{item.body}</p>
    {/if}
  </div>
{/if}
