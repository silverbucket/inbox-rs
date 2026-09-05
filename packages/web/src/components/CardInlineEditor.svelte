<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import {
    applyCardDraft,
    clearCardDraft,
    createCardDraft,
    draftsEqual,
    mergeExternalCardDraft,
    readCardDraft,
    writeCardDraft,
    type CardDraft,
  } from '../lib/card-draft';
  import { storeItem } from '../lib/stores';
  import MarkdownContentField from './add-entry/MarkdownContentField.svelte';

  export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'restored';

  let {
    item,
    status = $bindable<SaveStatus>('saved'),
    flush = $bindable<() => Promise<void>>(async () => {}),
    retry = $bindable<() => void>(() => {}),
    discard = $bindable<() => void>(() => {}),
    onfetchurlpreview = undefined,
    fetchingUrlPreview = false,
    children,
  }: {
    item: InboxItem;
    status?: SaveStatus;
    flush?: () => Promise<void>;
    retry?: () => void;
    /**
     * Drop any unsaved edit for good. Call after the card itself is gone
     * (deleted) so teardown doesn't write it back into existence.
     */
    discard?: () => void;
    onfetchurlpreview?: () => void;
    fetchingUrlPreview?: boolean;
    children?: Snippet;
  } = $props();

  const initialItem = untrack(() => item);
  // The latest item we've been handed, held outside the reactive graph. The
  // `item` prop is a lazy getter into the parent's state; after teardown
  // (route change closing the modal) it dereferences a null and throws, and
  // the save on destroy must not depend on it.
  let currentItem = initialItem;
  const recovered = readCardDraft(initialItem, localStorage);
  let draft = $state(recovered ?? createCardDraft(initialItem));
  let syncedDraft = $state<CardDraft>(
    untrack(() => structuredClone(createCardDraft(initialItem))),
  );
  let revision = recovered ? 1 : 0;
  let persistedRevision = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let savePromise: Promise<void> | null = null;
  let discarded = false;

  status = recovered ? 'restored' : 'saved';

  const hasPendingEdit = () => revision > persistedRevision && !discarded;

  function scheduleSave() {
    revision += 1;
    status = 'pending';
    writeCardDraft(draft, localStorage);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persist().catch(() => {}), 700);
  }

  async function persist(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (revision <= persistedRevision) return;
    if (savePromise) {
      await savePromise;
      if (revision > persistedRevision) await persist();
      return;
    }

    const savingRevision = revision;
    const snapshot = $state.snapshot(draft);
    const target = currentItem;
    status = 'saving';
    savePromise = storeItem(applyCardDraft(target, snapshot));
    try {
      await savePromise;
      if (revision === savingRevision) {
        persistedRevision = savingRevision;
        syncedDraft = structuredClone(snapshot);
        clearCardDraft(target.id, localStorage);
        status = 'saved';
      } else {
        status = 'pending';
        saveTimer = setTimeout(() => void persist().catch(() => {}), 0);
      }
    } catch (error) {
      console.error('Card autosave failed', error);
      status = 'error';
      throw error;
    } finally {
      savePromise = null;
    }
  }

  flush = persist;
  retry = () => void persist().catch(() => {});
  discard = () => {
    discarded = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
  };

  if (recovered) {
    saveTimer = setTimeout(() => void persist().catch(() => {}), 700);
  }

  // Closing is the save. Most exits go through the modal's own flush, but
  // the editor can also be torn down without it — a route change (mobile
  // back button, a nav tap), a deleted-elsewhere card, a parent re-key.
  // Dropping the debounce timer there stranded the edit in the device-local
  // draft, where it never synced until this exact card was reopened on this
  // exact device. Fire the save instead; storeItem outlives the component.
  onDestroy(() => {
    if (discarded || !hasPendingEdit()) {
      if (saveTimer) clearTimeout(saveTimer);
      return;
    }
    void persist().catch(() => {});
  });

  // Backgrounding the PWA or switching tabs can be the last thing that
  // happens before the process dies. Push the pending write as soon as the
  // page is hidden so the local cache commits and the next sync carries it.
  // `pagehide` (navigation, tab close) fires while the document still reports
  // itself visible, so it isn't gated on visibility. If the unload wins the
  // race anyway, the localStorage draft is replayed on the next launch — see
  // lib/card-draft-recovery.ts.
  function flushIfHidden() {
    if (document.visibilityState === 'visible') return;
    flushPending();
  }
  function flushPending() {
    if (hasPendingEdit()) void persist().catch(() => {});
  }
  $effect(() => {
    document.addEventListener('visibilitychange', flushIfHidden);
    window.addEventListener('pagehide', flushPending);
    return () => {
      document.removeEventListener('visibilitychange', flushIfHidden);
      window.removeEventListener('pagehide', flushPending);
    };
  });

  function noteExternalDraftChange() {
    revision += 1;
    status = 'pending';
    writeCardDraft(draft, localStorage);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persist().catch(() => {}), 700);
  }

  // Background updates (bookmark enrichment, transcription, etc.) flow through
  // the items store while the modal stays open. Merge them into the draft
  // without clobbering fields the user has edited locally.
  $effect(() => {
    const external = item;
    currentItem = external;
    untrack(() => {
      if (revision > persistedRevision) {
        const merged = mergeExternalCardDraft(draft, syncedDraft, external);
        if (merged) {
          draft = merged;
          noteExternalDraftChange();
        }
        return;
      }
      const next = createCardDraft(external);
      if (!draftsEqual(draft, next)) {
        draft = next;
        syncedDraft = structuredClone(next);
      }
    });
  });

  const hasBody = $derived(item.type === 'bookmark' || 'body' in item);
  const bodyLabel = $derived(
    item.type === 'bookmark'
      ? 'Notes'
      : item.type === 'todo'
      ? 'Details'
      : item.type === 'audio' || item.type === 'video'
        ? 'Transcription or notes'
        : 'Content',
  );
  const bodyPlaceholder = $derived(
    item.type === 'bookmark'
      ? 'Add personal notes about this bookmark…'
      : item.type === 'todo'
      ? 'Add details…'
      : item.type === 'email'
        ? 'Email body…'
        : item.type === 'audio' || item.type === 'video'
          ? 'Add a transcription or notes…'
          : 'Start writing…',
  );
  const descriptionIsPrimary = $derived(item.type === 'document');
  const hasUrl = $derived(item.type === 'bookmark' || item.type === 'image');
  const safeLinkUrl = $derived.by(() => {
    if (!draft.url) return null;
    try {
      const parsed = new URL(draft.url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? parsed.href
        : null;
    } catch {
      return null;
    }
  });
</script>

<section
  class="editor"
  class:compact={item.type === 'bookmark' || item.type === 'image'}
  aria-label="Card content"
>
  <div class="title-row">
    {#if item.isTodo || item.type === 'todo'}
      <label class="complete-toggle" title={draft.completed ? 'Mark open' : 'Mark complete'}>
        <input type="checkbox" bind:checked={draft.completed} onchange={scheduleSave} />
        <span aria-hidden="true"></span>
        <span class="sr-only">Completed</span>
      </label>
    {/if}
    <input
      class="title-input"
      bind:value={draft.title}
      oninput={scheduleSave}
      aria-label="Title"
      placeholder="Untitled"
    />
    {#if hasUrl && safeLinkUrl}
      <a class="source-link" href={safeLinkUrl} target="_blank" rel="noopener noreferrer">Open link ↗</a>
    {:else if item.type === 'email' && item.messageUrl}
      <a class="source-link" href={item.messageUrl}>Open email ↗</a>
    {/if}
  </div>

  {#if onfetchurlpreview}
    <div class="url-preview-prompt">
      <span>This note contains a link.</span>
      <button
        type="button"
        disabled={fetchingUrlPreview}
        onclick={onfetchurlpreview}
      >
        {fetchingUrlPreview ? 'Fetching preview…' : 'Fetch link preview'}
      </button>
    </div>
  {/if}

  {#if hasUrl}
    <label class="compact-field">
      <span class="field-label">URL</span>
      <input type="url" bind:value={draft.url} oninput={scheduleSave} placeholder="https://…" />
    </label>
  {:else if item.type === 'email'}
    <label class="compact-field">
      <span class="field-label">From</span>
      <input bind:value={draft.from} oninput={scheduleSave} placeholder="Sender" />
    </label>
  {/if}

  {#if hasBody}
    <MarkdownContentField
      bind:value={draft.body}
      label={bodyLabel}
      placeholder={bodyPlaceholder}
      onchange={scheduleSave}
    />
  {/if}

  {#if item.type === 'email'}
    <label class="text-field">
      <span class="field-label">Notes</span>
      <textarea bind:value={draft.notes} oninput={scheduleSave} rows="3" placeholder="Your notes about this email…"></textarea>
    </label>
  {/if}

  {@render children?.()}

  {#if descriptionIsPrimary}
    <label class="text-field description-primary">
      <span class="field-label">Description</span>
      <textarea bind:value={draft.description} oninput={scheduleSave} rows="6" placeholder="Add a description…"></textarea>
    </label>
  {:else}
    <details class="more-fields" open={!!draft.description}>
      <summary>More details</summary>
      <label class="text-field">
        <span class="field-label">Description</span>
        <textarea bind:value={draft.description} oninput={scheduleSave} rows="3" placeholder="Optional description…"></textarea>
      </label>
    </details>
  {/if}
</section>

<style>
  .editor {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1rem;
    min-height: 0;
  }

  /* Bookmark and image fields are short. Letting this section grow pushes the
     actual preview below the initial viewport of the full-height modal. */
  .editor.compact {
    flex: 0 0 auto;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .url-preview-prompt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--accent-subtle);
    color: var(--text-muted);
    font-size: 0.85rem;
    padding: 0.6rem 0.75rem;
  }

  .url-preview-prompt button {
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }

  .url-preview-prompt button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .title-input {
    min-width: 0;
    flex: 1;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: clamp(1.45rem, 3vw, 2.15rem);
    font-weight: 650;
    line-height: 1.2;
    padding: 0.35rem 0.45rem;
  }

  .title-input:hover {
    background: var(--surface-hover);
  }

  .title-input:focus {
    border-color: var(--border);
    background: var(--bg);
    outline: none;
  }

  .source-link {
    flex-shrink: 0;
    color: var(--accent);
    font-size: 0.8rem;
  }

  .complete-toggle {
    position: relative;
    display: grid;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    cursor: pointer;
    place-items: center;
  }

  .complete-toggle input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .complete-toggle > span:not(.sr-only) {
    width: 22px;
    height: 22px;
    border: 2px solid var(--text-muted);
    border-radius: 50%;
  }

  .complete-toggle input:checked + span {
    border-color: var(--accent);
    background: var(--accent);
    box-shadow: inset 0 0 0 4px var(--surface);
  }

  .complete-toggle input:focus-visible + span {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .compact-field,
  .text-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .field-label {
    color: var(--text-muted);
    font-size: 0.78rem;
    font-weight: 500;
  }

  .compact-field input,
  .text-field textarea {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font-family: inherit;
    font-size: 1rem;
    line-height: 1.5;
    padding: 0.65rem 0.75rem;
  }

  .compact-field input:focus,
  .text-field textarea:focus {
    border-color: var(--accent);
    outline: none;
  }

  .text-field textarea {
    resize: vertical;
  }

  .description-primary {
    flex: 1;
  }

  .description-primary textarea {
    flex: 1;
    min-height: 12rem;
  }

  .more-fields {
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  .more-fields summary {
    width: max-content;
    cursor: pointer;
    user-select: none;
  }

  .more-fields .text-field {
    margin-top: 0.65rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    clip-path: inset(50%);
  }

  @media (max-width: 600px) {
    .title-row {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .source-link {
      margin-left: 2.75rem;
    }
  }
</style>
