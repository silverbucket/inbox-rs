<script lang="ts">
  import type { Component } from 'svelte';
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import type { InboxItemType, InboxItem } from '@inbox-rs/rs-module';
  import {
    storeItem, moveItemToCollection,
    sortedGroups, groupCollections,
    hasUncategorizedItems, UNCATEGORIZED_COLLECTION_ID,
    collections, appConfig, updateConfig,
  } from '../lib/stores';
  import { renderMarkdown } from '../lib/markdown';
  import { transcribeAudio } from '../lib/transcribe';
  import { loadMarkdownEditorComponent, shouldLoadMarkdownEditor, shouldSubmitAddEntryForm } from '../lib/add-entry-modal';
  import { isInsideCodeBlock, insertIndent, indentSelection, dedentSelection, insertNewlineWithIndent, isOnClosingFence } from '../lib/code-indent';
  import { autofocus } from '../lib/actions';

  let { type, editItem = undefined, collectionId = undefined, onclose, ondelete }: {
    type: InboxItemType;
    editItem?: InboxItem;
    collectionId?: string;
    onclose: () => void;
    ondelete?: (item: InboxItem) => void;
  } = $props();

  const isEdit = !!editItem;
  let saving = $state(false);

  /**
   * Find the first real collection in display order — iterate groups in
   * sorted order, then take the first collection from each. Used as the
   * last-resort default for the todo picker when
   * there's no explicit `collectionId` prop and no valid
   * `lastSelectedCollectionId`. Returns `undefined` when the user has no
   * collections at all (the picker then shows its empty-state hint).
   */
  function firstAvailableCollectionId(): string | undefined {
    for (const group of get(sortedGroups)) {
      const cols = get(groupCollections)[group.id] ?? [];
      if (cols.length > 0) return cols[0].id;
    }
    return undefined;
  }

  /**
   * Pick the initial collection for the todo picker so the user doesn't
   * land on a blank destination when creating repeat todos. Resolution:
   *   1. Explicit `collectionId` prop (e.g. quick-add from a collection
   *      row) — honored verbatim.
   *   2. `lastSelectedCollectionId` from appConfig, validated against the
   *      collections store. Deleted collections are ignored and we fall
   *      through.
   *   3. First available real collection in display order.
   *   4. `undefined` — no collections exist yet; the picker surfaces a
   *      "create a collection first" hint and submit stays disabled.
   *
   * Only applied to new todos; refs keep defaulting to the Inbox
   * (`undefined` here means Inbox), and edits reuse the existing item's
   * collection context.
   */
  function pickInitialCollectionId(): string | undefined {
    if (collectionId !== undefined) return collectionId;
    if (isEdit) return undefined;
    if (type !== 'todo') return undefined;
    const last = get(appConfig).lastSelectedCollectionId;
    if (last && get(collections)[last]) return last;
    return firstAvailableCollectionId();
  }

  // Let the user pick the destination collection from within the modal for
  // every new item. See `pickInitialCollectionId` for the default cascade.
  let selectedCollectionId = $state<string | undefined>(pickInitialCollectionId());
  let collectionPickerOpen = $state(false);
  let collectionPickerEl = $state<HTMLDivElement>();
  let collectionPickerTriggerEl = $state<HTMLButtonElement>();
  // Collection dropdown menu position, computed when opened. Positioned
  // with `position: fixed` so it escapes the modal's `overflow: hidden`
  // (note modal) and the modal's rounded border clipping (other modals).
  // Flips upward when there's no room below.
  let pickerMenuStyle = $state('');
  const showCollectionPicker = $derived(!isEdit);

  // Todos must have a collection — they can't live in the Inbox (refs-only
  // staging area) and the Uncategorized bucket is reserved for stragglers
  // produced by deleting a collection. So for todos we surface no
  // "no-collection" default at all; the user picks a real collection or the
  // Save button stays disabled. For refs, `undefined` means "Inbox" (the
  // default landing).
  const isTodoType = $derived(type === 'todo');
  const noCollectionLabel = 'Inbox';

  // `undefined` is the non-collection sentinel — for refs it means "Inbox".
  // Todos never use the `undefined` selection (the picker hides that row),
  // but we still show a placeholder label until a real collection is picked.
  const collectionLabel = $derived.by(() => {
    if (selectedCollectionId === undefined) {
      return isTodoType ? 'Choose a collection…' : noCollectionLabel;
    }
    if (selectedCollectionId === UNCATEGORIZED_COLLECTION_ID) return 'Uncategorized';
    for (const group of $sortedGroups) {
      const cols = $groupCollections[group.id] ?? [];
      const found = cols.find(c => c.id === selectedCollectionId);
      if (found) return found.name;
    }
    return noCollectionLabel;
  });

  // Show an explicit "Uncategorized" picker row for refs only when the bucket
  // already exists (has stragglers). Per the design, Uncategorized is a
  // dynamic surface that appears when items live there — it shouldn't be a
  // first-class destination unless it's already populated. Todos normally
  // can't route there (they require a real collection), but when a caller
  // explicitly preselected Uncategorized (e.g. the quick-add on an
  // uncategorized todo row) we surface it in the picker so the current
  // selection is visible and reselectable.
  const showUncategorizedInPicker = $derived(
    (!isTodoType && $hasUncategorizedItems)
    || selectedCollectionId === UNCATEGORIZED_COLLECTION_ID
  );

  // Whether the user has any real grouped collections at all.
  // Used to decide when to surface an empty-state hint in the todo picker —
  // todos require a real collection, so an empty picker is a dead end without
  // guidance.
  const hasAnyCollection = $derived.by(() => {
    for (const group of $sortedGroups) {
      if (($groupCollections[group.id] ?? []).length > 0) return true;
    }
    return false;
  });

  $effect(() => {
    if (!collectionPickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (collectionPickerEl && !collectionPickerEl.contains(e.target as Node)) collectionPickerOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') collectionPickerOpen = false;
    };
    // Re-position on resize/scroll so the fixed-position menu stays anchored
    // to the trigger — the modal content can scroll behind it, and on mobile
    // the viewport can change on orientation / keyboard appearance.
    const reposition = () => positionPickerMenu();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  });

  function selectCollection(id: string | undefined) {
    selectedCollectionId = id;
    collectionPickerOpen = false;
  }

  /**
   * Exit the modal and jump to the Collections page. Used from the todo
   * picker's empty state — the user needs a real collection before they can
   * save a todo, and there's no in-page affordance to create one without
   * navigating away. The in-progress form is discarded on `onclose`; that's
   * acceptable since the Save button is disabled anyway (no collection to
   * file into).
   */
  function goToCollections() {
    onclose();
    if (window.location.hash !== '#/collections') {
      window.location.hash = '#/collections';
    }
  }

  /**
   * Compute the dropdown menu position relative to the trigger using
   * viewport coordinates. We render the menu with `position: fixed` so it
   * escapes the modal's clipping contexts (overflow: hidden on the note
   * modal, rounded border on others) and can always extend past the modal.
   * If there's not enough room below the trigger for the menu (max 320px),
   * flip it to open upward.
   */
  function positionPickerMenu() {
    if (!collectionPickerTriggerEl) return;
    const rect = collectionPickerTriggerEl.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const menuMaxHeight = 320;
    const gap = 4;
    const spaceBelow = viewportHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const preferUp = spaceBelow < Math.min(menuMaxHeight, 200) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(menuMaxHeight, preferUp ? spaceAbove : spaceBelow));
    const left = rect.left;
    const width = rect.width;
    if (preferUp) {
      const bottom = viewportHeight - rect.top + gap;
      pickerMenuStyle = `left: ${left}px; width: ${width}px; bottom: ${bottom}px; max-height: ${maxHeight}px;`;
    } else {
      const top = rect.bottom + gap;
      pickerMenuStyle = `left: ${left}px; width: ${width}px; top: ${top}px; max-height: ${maxHeight}px;`;
    }
  }

  function togglePicker() {
    if (!collectionPickerOpen) positionPickerMenu();
    collectionPickerOpen = !collectionPickerOpen;
  }

  // Form fields — pre-populate from editItem if editing
  let title = $state(editItem?.title ?? '');
  let url = $state(editItem && 'url' in editItem ? editItem.url : '');
  let body = $state(editItem && 'body' in editItem ? editItem.body ?? '' : '');
  let description = $state(editItem?.description ?? '');
  let completed = $state(editItem && 'completed' in editItem ? editItem.completed : false);
  let from = $state(editItem && 'from' in editItem ? editItem.from ?? '' : '');
  let notes = $state(editItem && 'notes' in editItem ? editItem.notes ?? '' : '');
  let file = $state<File | null>(null);

  // Markdown editor mode for notes
  let editorMode = $state<'visual' | 'write' | 'preview'>('visual');
  let MarkdownEditorComponent = $state<Component<any> | null>(null);
  let markdownEditorLoadError = $state('');
  let previewHtml = $state('');

  // Voice recording state
  let recording = $state(false);
  let recordingDuration = $state(0);
  let recordedBlob = $state<Blob | null>(null);
  let recordedUrl = $state<string | null>(null);
  let transcript = $state('');
  let transcribing = $state(false);
  let transcriptionId = 0;
  let mediaRecorder: MediaRecorder | null = null;
  let recordingInterval: ReturnType<typeof setInterval> | null = null;

  async function runTranscription(blob: Blob) {
    const myId = ++transcriptionId;
    transcribing = true;
    try {
      const result = await transcribeAudio(blob);
      if (myId !== transcriptionId) return; // discarded
      transcript = result;
      if (transcript && !body) body = transcript;
      if (transcript && !title) title = transcript.slice(0, 50);
    } catch (e) {
      if (myId !== transcriptionId) return;
      console.warn('Transcription failed:', e);
    } finally {
      if (myId === transcriptionId) transcribing = false;
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        const mimeType = mediaRecorder?.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        recordedBlob = blob;
        recordedUrl = URL.createObjectURL(blob);
        file = null;
        runTranscription(blob);
      };
      mediaRecorder.start();
      recording = true;
      recordingDuration = 0;
      recordingInterval = setInterval(() => { recordingDuration++; }, 1000);
    } catch {
      // Mic permission denied or unavailable
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    recording = false;
    if (recordingInterval) {
      clearInterval(recordingInterval);
      recordingInterval = null;
    }
  }

  function discardRecording() {
    transcriptionId++; // cancel in-flight transcription
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    recordedBlob = null;
    recordedUrl = null;
    recordingDuration = 0;
    transcript = '';
    transcribing = false;
  }

  function formatTimer(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const addLabels: Record<InboxItemType, string> = {
    'bookmark': 'Add Bookmark',
    'note': 'Add Note',
    'image': 'Add Image',
    'audio': 'Add Audio',
    'document': 'Add File',
    'todo': 'Add Todo',
    'email': 'Add Email',
  };

  const editLabels: Record<InboxItemType, string> = {
    'bookmark': 'Edit Bookmark',
    'note': 'Edit Note',
    'image': 'Edit Image',
    'audio': 'Edit Audio',
    'document': 'Edit File',
    'todo': 'Edit Todo',
    'email': 'Edit Email',
  };

  function handleFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    file = input.files?.[0] ?? null;
  }

  function getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.slice(dot) : '';
  }

  let error = $state('');

  // For edit mode, check if the item already has a file
  const hasExistingFile = isEdit && 'filePath' in editItem! && !!editItem!.filePath;

  async function handleSubmit() {
    saving = true;
    error = '';
    try {
      const id = isEdit ? editItem!.id : crypto.randomUUID();
      const createdAt = isEdit ? editItem!.createdAt : new Date().toISOString();
      let item: InboxItem;
      let fileData: ArrayBuffer | undefined;

      if (type === 'bookmark') {
        item = { id, type: 'bookmark', title: title || url, url, description: description || undefined, createdAt };
        // Preserve existing bookmark metadata when editing
        if (isEdit && editItem!.type === 'bookmark') {
          const e = editItem!;
          if (e.favicon) (item as any).favicon = e.favicon;
          if (e.ogImage) (item as any).ogImage = e.ogImage;
          if (e.siteName) (item as any).siteName = e.siteName;
          if (e.body) (item as any).body = e.body;
          if (e.filePath) (item as any).filePath = e.filePath;
          if (e.mimeType) (item as any).mimeType = e.mimeType;
        }
      } else if (type === 'note') {
        item = { id, type: 'note', title: title || body.slice(0, 50), body, description: description || undefined, createdAt };
      } else if (type === 'image') {
        if (file) {
          const existingPath = isEdit && editItem!.type === 'image' ? editItem!.filePath : undefined;
          const ext = getExtension(file.name);
          const filePath = existingPath || `files/${id}${ext}`;
          fileData = await file.arrayBuffer();
          item = { id, type: 'image', title: title || file.name, filePath, mimeType: file.type, description: description || undefined, createdAt };
        } else if (isEdit && editItem!.type === 'image') {
          item = { ...editItem!, title: title || editItem!.title, description: description || undefined };
        } else {
          return;
        }
      } else if (type === 'audio') {
        if (recordedBlob || file) {
          const existingPath = isEdit && editItem!.type === 'audio' ? editItem!.filePath : undefined;
          let filePath: string;
          let mimeType: string;
          let duration: number | undefined;
          if (recordedBlob) {
            const ext = recordedBlob.type.includes('webm') ? '.webm' : recordedBlob.type.includes('mp4') ? '.mp4' : '.ogg';
            filePath = existingPath || `files/${id}${ext}`;
            mimeType = recordedBlob.type || 'audio/webm';
            fileData = await recordedBlob.arrayBuffer();
            duration = recordingDuration || undefined;
          } else if (file) {
            const ext = getExtension(file.name);
            filePath = existingPath || `files/${id}${ext}`;
            mimeType = file.type;
            fileData = await file.arrayBuffer();
          } else {
            return;
          }
          const memoBody = body || transcript || undefined;
          const autoTitle = title || transcript || 'Audio';
          const transcribed = !!(recordedBlob || transcript || body) || undefined;
          item = { id, type: 'audio', title: autoTitle, filePath, mimeType, duration, body: memoBody, transcribed, description: description || undefined, createdAt };
        } else if (isEdit && editItem!.type === 'audio') {
          item = { ...editItem!, title: title || editItem!.title, body: body || undefined, description: description || undefined };
        } else {
          return;
        }
      } else if (type === 'document') {
        if (file) {
          const existingPath = isEdit && editItem!.type === 'document' ? editItem!.filePath : undefined;
          const ext = getExtension(file.name);
          const filePath = existingPath || `files/${id}${ext}`;
          fileData = await file.arrayBuffer();
          item = { id, type: 'document', title: title || file.name, filePath, mimeType: file.type, fileSize: file.size, fileName: file.name, description: description || undefined, createdAt };
        } else if (isEdit && editItem!.type === 'document') {
          item = { ...editItem!, title: title || editItem!.title, description: description || undefined };
        } else {
          return;
        }
      } else if (type === 'email') {
        const emailMessageUrl = isEdit && editItem!.type === 'email' ? editItem!.messageUrl : undefined;
        item = { id, type: 'email', title: title || 'Untitled email', body, from: from || undefined, notes: notes || undefined, messageUrl: emailMessageUrl, createdAt };
      } else if (type === 'todo') {
        item = { id, type: 'todo', title, body: body || undefined, completed, completedAt: completed && !(editItem && 'completed' in editItem && editItem.completed) ? new Date().toISOString() : (editItem && 'completedAt' in editItem ? editItem.completedAt : undefined), description: description || undefined, createdAt, isTodo: true };
      } else {
        return;
      }

      // Preserve todo fields when editing non-todo types (converted items).
      // For actual todo types, the form's completed checkbox is the source of truth.
      if (isEdit && type !== 'todo') {
        if (editItem!.isTodo) item.isTodo = true;
        if (editItem!.completed) item.completed = editItem!.completed;
        if (editItem!.completedAt) item.completedAt = editItem!.completedAt;
      }

      if (!isEdit && collectionId && collectionId !== UNCATEGORIZED_COLLECTION_ID) {
        // The Uncategorized sentinel is a picker-level id, not a real
        // collection id — writing it to `item.collectionId` would leave a
        // bogus reference in storage. The branch below (selectedCollectionId
        // === UNCATEGORIZED_COLLECTION_ID) handles the Uncategorized case by
        // setting the `uncategorized` flag and leaving `collectionId` unset.
        item.collectionId = collectionId;
      }

      // Picker → storage shape:
      //   undefined + ref         → Inbox (default; no flag, no collectionId)
      //   undefined + todo        → Uncategorized (no flag needed — todos
      //                              without a collectionId are uncategorized
      //                              by definition, see
      //                              uncategorizedVirtualCollection)
      //   UNCATEGORIZED_... + ref → Uncategorized (set `uncategorized: true`
      //                              before storage; no moveItemToCollection
      //                              call since there's no real collection
      //                              record to update)
      //   real id                 → assign via moveItemToCollection after storage
      if (!isEdit && selectedCollectionId === UNCATEGORIZED_COLLECTION_ID) {
        item!.uncategorized = true;
      }
      await storeItem(item!, fileData);
      if (selectedCollectionId && selectedCollectionId !== UNCATEGORIZED_COLLECTION_ID && !isEdit) {
        await moveItemToCollection(item!.id, selectedCollectionId);
      }
      // Remember the destination for next time, but only for new todos — the
      // preference seeds `pickInitialCollectionId`. Refs default to Inbox so
      // there's nothing useful to remember for them; edits don't expose the
      // picker. Uncategorized is explicitly excluded so we never bring the
      // user back to the ref-only bucket as a default.
      if (
        !isEdit
        && type === 'todo'
        && selectedCollectionId
        && selectedCollectionId !== UNCATEGORIZED_COLLECTION_ID
      ) {
        try {
          await updateConfig({ lastSelectedCollectionId: selectedCollectionId });
        } catch (e) {
          console.error('Failed to persist lastSelectedCollectionId', e);
        }
      }
      onclose();
    } catch (e) {
      console.error('Save failed:', e);
      error = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e) || 'Failed to save';
    } finally {
      saving = false;
    }
  }

  async function convertToTodo() {
    saving = true;
    error = '';
    try {
      const { completedAt: _, ...rest } = editItem!;
      const updated = { ...rest, isTodo: true, completed: false };
      await storeItem(updated as InboxItem);
      onclose();
    } catch (e) {
      console.error('Convert failed:', e);
      error = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e) || 'Failed to convert';
    } finally {
      saving = false;
    }
  }

  /**
   * Apply a computed TextState to a textarea using setRangeText, which
   * preserves native undo/redo and auto-fires the input event.
   */
  function applyTextState(
    ta: HTMLTextAreaElement,
    next: import('../lib/code-indent').TextState,
  ) {
    ta.setRangeText(next.value, 0, ta.value.length, 'end');
    ta.selectionStart = next.selectionStart;
    ta.selectionEnd = next.selectionEnd;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Track whether Escape was pressed to release the Tab trap.
  // Reset when the textarea regains focus or the user types a normal key.
  let tabTrapped = $state(true);

  /** Handle Tab, Enter, and Escape for auto-indenting inside code areas */
  function handleCodeKeydown(e: KeyboardEvent, alwaysActive: boolean = false) {
    const ta = e.currentTarget as HTMLTextAreaElement;

    if (e.key === 'Escape') {
      tabTrapped = false;
      return;
    }

    // Any non-modifier key re-enables the Tab trap (user is typing again).
    if (!e.key.startsWith('Shift') && !e.key.startsWith('Alt') && !e.key.startsWith('Control') && !e.key.startsWith('Meta') && e.key !== 'Tab' && e.key !== 'Enter') {
      tabTrapped = true;
    }

    const active = alwaysActive || isInsideCodeBlock(ta.value, ta.selectionStart);
    if (!active) return;

    if (e.key === 'Tab' && tabTrapped) {
      e.preventDefault();
      const state = { value: ta.value, selectionStart: ta.selectionStart, selectionEnd: ta.selectionEnd };
      if (state.selectionStart === state.selectionEnd) {
        applyTextState(ta, insertIndent(state));
      } else if (e.shiftKey) {
        applyTextState(ta, dedentSelection(state));
      } else {
        applyTextState(ta, indentSelection(state));
      }
    } else if (e.key === 'Enter') {
      if (!alwaysActive && isOnClosingFence(ta.value, ta.selectionStart)) return;

      e.preventDefault();
      const state = { value: ta.value, selectionStart: ta.selectionStart, selectionEnd: ta.selectionEnd };
      applyTextState(ta, insertNewlineWithIndent(state));
    }
  }

  onDestroy(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    if (recordingInterval) clearInterval(recordingInterval);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
  });

  $effect(() => {
    if (!shouldLoadMarkdownEditor(type, editorMode, !!MarkdownEditorComponent, !!markdownEditorLoadError)) {
      return;
    }

    let cancelled = false;

    loadMarkdownEditorComponent()
      .then((component) => {
        if (!cancelled) {
          MarkdownEditorComponent = component;
        }
      })
      .catch((loadError) => {
        console.error('Failed to load markdown editor:', loadError);
        if (!cancelled) {
          markdownEditorLoadError = 'Visual editor unavailable. Markdown mode is still available.';
          editorMode = 'write';
        }
      });

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (type !== 'note' || editorMode !== 'preview') {
      previewHtml = '';
      return;
    }

    const currentBody = body;
    let cancelled = false;

    renderMarkdown(currentBody)
      .then((html) => {
        if (!cancelled && body === currentBody && editorMode === 'preview') {
          previewHtml = html;
        }
      })
      .catch(() => {
        if (!cancelled) {
          previewHtml = '';
        }
      });

    return () => {
      cancelled = true;
    };
  });

  const needsFile = $derived(type === 'image' || type === 'document');
  const canSubmit = $derived(
    saving || recording ? false
    : type === 'audio' ? !!(file || recordedBlob || hasExistingFile)
    : needsFile ? !!(file || hasExistingFile)
    : type === 'bookmark' ? !!url
    : type === 'note' ? !!(title || body)
    : type === 'email' ? !!body
    : type === 'todo' ? !!title && !!selectedCollectionId
    : true
  );
</script>

<!--
  Window-level Escape handler — closes the modal so the user can dismiss it
  from anywhere (including textareas and rich editors that might otherwise
  swallow keys). When the collection picker is open, ESC closes the picker
  first instead of dropping the user out of the whole modal — matches what
  users expect from layered overlays elsewhere in the app.
-->
<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    if (collectionPickerOpen) {
      collectionPickerOpen = false;
      return;
    }
    onclose();
  }}
/>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose}>
  <div class="modal" class:modal-note={type === 'note'} role="dialog" aria-modal="true" aria-labelledby="modal-title" onclick={(e) => e.stopPropagation()}>
    <h2 class="modal-title" id="modal-title">{isEdit ? editLabels[type] : addLabels[type]}</h2>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="form" onkeydown={(e) => { if (shouldSubmitAddEntryForm(e.key, e.target, canSubmit)) { e.preventDefault(); handleSubmit(); } }}>
      {#if type === 'bookmark'}
        <p class="info-note">Metadata fetching is not yet available in the web app. Use the browser extension to auto-fill bookmark details. Sockethub integration is planned for a future release.</p>
        <label class="field">
          <span>URL *</span>
          <input use:autofocus type="url" bind:value={url} placeholder="https://..." />
        </label>
        <label class="field">
          <span>Title</span>
          <input type="text" bind:value={title} placeholder="Page title" />
        </label>
        <label class="field">
          <span>Note</span>
          <textarea bind:value={description} rows="2" placeholder="Optional note..."></textarea>
        </label>

      {:else if type === 'note'}
        <label class="field">
          <span>Title</span>
          <!--
            Title is autofocused for the note modal too. The visual editor
            below is async-loaded and doesn't autofocus on mount, so without
            this the user opens the modal and lands on no field at all. When
            in `write` (Markdown) mode the body textarea also has
            `use:autofocus` and runs later in the DOM, so it wins the focus
            race and the user lands in the editor — which is what they want
            once they've explicitly switched to Markdown mode.
          -->
          <input use:autofocus type="text" bind:value={title} placeholder="Note title" />
        </label>
        <div class="field note-editor-field">
          <div class="field-header">
            <span>Content</span>
            <div class="editor-tabs">
              <button type="button" class="tab" class:active={editorMode === 'visual'} onclick={() => editorMode = 'visual'} disabled={!!markdownEditorLoadError}>Visual</button>
              <button type="button" class="tab" class:active={editorMode === 'write'} onclick={() => editorMode = 'write'}>Markdown</button>
              <button type="button" class="tab" class:active={editorMode === 'preview'} onclick={() => editorMode = 'preview'}>Preview</button>
            </div>
          </div>
          {#if editorMode === 'visual'}
            {#if MarkdownEditorComponent}
              <MarkdownEditorComponent bind:value={body} placeholder="Write your note..." />
            {:else if markdownEditorLoadError}
              <textarea
                use:autofocus
                class="code-input"
                bind:value={body}
                rows="10"
                placeholder="Write your note in Markdown..."
                onkeydown={handleCodeKeydown}
              ></textarea>
            {:else}
              <div class="editor-loading" aria-live="polite">Loading visual editor…</div>
            {/if}
          {:else if editorMode === 'write'}
            <textarea
              use:autofocus
              class="code-input"
              bind:value={body}
              rows="10"
              placeholder="Write your note in Markdown..."
              onkeydown={handleCodeKeydown}
            ></textarea>
          {:else}
            <div class="preview-wrap markdown-body">
              {#if previewHtml}
                {@html previewHtml}
              {:else if body.trim()}
                <span class="preview-empty">Preview unavailable</span>
              {:else}
                <span class="preview-empty">Nothing to preview</span>
              {/if}
            </div>
          {/if}
        </div>
        {#if markdownEditorLoadError}
          <p class="info-note">{markdownEditorLoadError}</p>
        {/if}

      {:else if type === 'image'}
        <label class="field">
          <span>{hasExistingFile ? 'Replace image' : 'Image *'}</span>
          <input type="file" accept="image/*" onchange={handleFileChange} />
        </label>
        <label class="field">
          <span>Title</span>
          <input use:autofocus type="text" bind:value={title} placeholder="Image title" />
        </label>
        <label class="field">
          <span>Description</span>
          <textarea bind:value={description} rows="2" placeholder="Optional description..."></textarea>
        </label>

      {:else if type === 'audio'}
        {#if !isEdit}
          <div class="field">
            <span>Record</span>
            <div class="recorder">
              {#if recording}
                <span class="rec-indicator"></span>
                <span class="rec-timer">{formatTimer(recordingDuration)}</span>
                <button type="button" class="rec-btn rec-stop" onclick={stopRecording}>Stop</button>
              {:else if recordedBlob}
                <audio controls src={recordedUrl} preload="metadata"></audio>
                <button type="button" class="rec-btn rec-discard" onclick={discardRecording}>Discard</button>
              {:else}
                <button type="button" class="rec-btn rec-start" onclick={startRecording}>Start Recording</button>
              {/if}
            </div>
          </div>
          {#if transcribing}
            <p class="transcript-status">Transcribing...</p>
          {/if}
          {#if transcript}
            <div class="field">
              <span>Transcript</span>
              <p class="transcript">{transcript}</p>
            </div>
          {/if}
          {#if !recordedBlob && !recording}
            <label class="field">
              <span>Or upload audio file</span>
              <input type="file" accept="audio/*" onchange={handleFileChange} />
            </label>
          {/if}
        {/if}
        <label class="field">
          <span>Title</span>
          <input use:autofocus type="text" bind:value={title} placeholder="Memo title" />
        </label>
        <label class="field">
          <span>Body</span>
          <textarea class="auto-expand" bind:value={body} rows="3" placeholder="Transcription or notes..."></textarea>
        </label>

      {:else if type === 'document'}
        <label class="field">
          <span>{hasExistingFile ? 'Replace file' : 'File *'}</span>
          <input type="file" onchange={handleFileChange} />
        </label>
        <label class="field">
          <span>Title</span>
          <input use:autofocus type="text" bind:value={title} placeholder="Document title" />
        </label>
        <label class="field">
          <span>Description</span>
          <textarea bind:value={description} rows="2" placeholder="Optional description..."></textarea>
        </label>

      {:else if type === 'email'}
        <label class="field">
          <span>Subject</span>
          <input use:autofocus type="text" bind:value={title} placeholder="Email subject" />
        </label>
        <label class="field">
          <span>From</span>
          <input type="text" bind:value={from} placeholder="Sender" />
        </label>
        <label class="field">
          <span>Body *</span>
          <textarea bind:value={body} rows="6" placeholder="Email body..."></textarea>
        </label>
        <label class="field">
          <span>Notes</span>
          <textarea bind:value={notes} rows="2" placeholder="Optional notes..."></textarea>
        </label>

      {:else if type === 'todo'}
        <label class="field">
          <span>Title *</span>
          <input use:autofocus type="text" bind:value={title} placeholder="What needs to be done?" />
        </label>
        <label class="field">
          <span>Details</span>
          <textarea bind:value={body} rows="3" placeholder="Optional details..." onkeydown={handleCodeKeydown}></textarea>
        </label>
        {#if isEdit}
          <label class="field checkbox-field">
            <input type="checkbox" bind:checked={completed} />
            <span>Completed</span>
          </label>
        {/if}
      {/if}

      {#if showCollectionPicker}
        <div class="field">
          <span>Collection</span>
          <div class="dest-wrapper" bind:this={collectionPickerEl}>
            <button
              type="button"
              class="dest-trigger"
              bind:this={collectionPickerTriggerEl}
              onclick={togglePicker}
              aria-haspopup="listbox"
              aria-expanded={collectionPickerOpen}
            >
              <span class="dest-label">{collectionLabel}</span>
              <svg class="dest-chevron" class:open={collectionPickerOpen} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            {#if collectionPickerOpen}
              <div class="dest-menu" role="listbox" aria-label="Destination" style={pickerMenuStyle}>
                <!--
                  Default non-collection destination. Refs-only — the row
                  files the new ref into the Inbox (the default landing).
                  Hidden for todos, which require a real collection.
                -->
                {#if !isTodoType}
                  <button
                    type="button"
                    class="dest-item"
                    class:selected={selectedCollectionId === undefined}
                    onclick={() => selectCollection(undefined)}
                  >
                    <span class="dest-dot inbox" aria-hidden="true"></span>
                    {noCollectionLabel}
                  </button>
                {/if}
                {#if showUncategorizedInPicker}
                  <!--
                    Explicit "Uncategorized" destination row. Surfaces for:
                    (a) refs when the bucket already exists, so the user can
                        file a new ref alongside existing stragglers without
                        first sending it to the Inbox and moving it; and
                    (b) todos when the caller preselected the Uncategorized
                        sentinel (e.g. the quick-add on an uncategorized todo
                        row) — shown so the current selection is visible and
                        the user can reselect it after browsing real
                        collections.
                  -->
                  <button
                    type="button"
                    class="dest-item"
                    class:selected={selectedCollectionId === UNCATEGORIZED_COLLECTION_ID}
                    onclick={() => selectCollection(UNCATEGORIZED_COLLECTION_ID)}
                  >
                    <span class="dest-dot" style="background: #9ca3af" aria-hidden="true"></span>
                    Uncategorized
                  </button>
                {/if}
                {#each $sortedGroups as group (group.id)}
                  {@const cols = $groupCollections[group.id] ?? []}
                  {#if cols.length > 0}
                    <div class="dest-group-label" style="--group-color: {group.color || 'var(--accent)'}">
                      <span class="dest-dot" style="background: var(--group-color)" aria-hidden="true"></span>
                      {group.name}
                    </div>
                    {#each cols as col (col.id)}
                      <button
                        type="button"
                        class="dest-item nested"
                        class:selected={selectedCollectionId === col.id}
                        onclick={() => selectCollection(col.id)}
                      >
                        <span class="dest-dot" style="background: {col.color || 'var(--accent)'}" aria-hidden="true"></span>
                        {col.name}
                      </button>
                    {/each}
                  {/if}
                {/each}
                {#if isTodoType && !hasAnyCollection}
                  <!--
                    Todos require a real collection, so when the user has no
                    collections at all the picker would otherwise render
                    completely empty. Surface an actionable hint + a jump
                    button so the user isn't stuck — losing the in-progress
                    title is acceptable since there's nowhere to save it yet.
                    Note: the virtual Uncategorized bucket (if present) is a
                    read-only fallback for stragglers and isn't a real
                    collection, so it deliberately isn't offered here.
                  -->
                  <div class="dest-empty">
                    <p class="dest-empty-title">No collections yet</p>
                    <p class="dest-empty-hint">Todos need a collection. Create one to file this todo into.</p>
                    <button
                      type="button"
                      class="dest-empty-cta"
                      onclick={goToCollections}
                    >
                      Go to Collections
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="actions">
        {#if isEdit && ondelete && editItem}
          <button class="btn-delete-item" disabled={saving} onclick={() => ondelete(editItem!)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Delete
          </button>
        {/if}
        <button class="btn-cancel" onclick={onclose}>Cancel</button>
        <button class="btn-save" disabled={!canSubmit} onclick={handleSubmit}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--overlay);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 3rem 1rem;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    max-width: 480px;
    padding: 1.5rem;
    margin-left: auto;
    margin-right: auto;
  }

  @media (max-width: 600px), (display-mode: standalone) {
    .overlay {
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
      background: var(--bg);
    }

    .modal {
      max-width: none;
      min-height: 100%;
      border: none;
      border-radius: 0;
    }
  }

  .modal-note {
    max-width: 720px;
    height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-note .form {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .modal-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.75rem;
  }

  .field span {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .checkbox-field {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }

  .checkbox-field input[type="checkbox"] {
    accent-color: var(--accent);
  }

  input[type="text"],
  input[type="url"],
  textarea {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    color: var(--text);
    font-family: inherit;
    resize: vertical;
  }

  input[type="text"]:focus,
  input[type="url"]:focus,
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  input[type="file"] {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .auto-expand {
    resize: vertical;
    min-height: 4.5em;
    max-height: 50vh;
    overflow-y: auto;
    field-sizing: content;
  }

  .code-input {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    font-size: 0.8rem;
    line-height: 1.5;
    tab-size: 2;
  }

  .editor-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 14rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .preview-wrap {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    overflow-y: auto;
    min-height: 0;
  }

  .preview-empty {
    color: var(--text-muted);
    font-style: italic;
    font-size: 0.85rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .btn-delete-item {
    margin-right: auto;
    background: none;
    border: 1px solid var(--border);
    color: var(--danger, #ef4444);
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    transition: background 0.15s, border-color 0.15s;
  }

  .btn-delete-item:hover {
    background: color-mix(in srgb, var(--danger) 10%, transparent 90%);
    border-color: var(--danger, #ef4444);
  }

  .btn-delete-item:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn-todo {
    margin-right: auto;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    transition: color 0.15s, border-color 0.15s;
  }

  .btn-todo:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .btn-todo:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn-cancel {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .btn-cancel:hover {
    border-color: var(--text-muted);
  }

  .btn-save {
    background: var(--accent);
    border: none;
    color: white;
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-save:hover {
    opacity: 0.9;
  }

  .btn-save:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .info-note {
    font-size: 0.8rem;
    color: var(--text-muted);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    margin: 0 0 0.75rem;
    line-height: 1.5;
  }

  .dest-wrapper {
    position: relative;
  }

  .dest-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s;
    white-space: nowrap;
  }

  .dest-trigger:hover {
    border-color: var(--accent);
  }

  .dest-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85rem;
    color: var(--text);
    font-weight: 400;
  }

  .dest-chevron {
    transition: transform 150ms;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .dest-chevron.open {
    transform: rotate(180deg);
  }

  /*
   * Fixed positioning (set dynamically via inline style) lets the menu
   * escape the modal's clipping contexts — the note modal sets
   * `overflow: hidden` on the form, and the modal frame's rounded corners
   * visually clip dropdowns that extend past the modal edge. A higher
   * z-index than the overlay (200) keeps the menu on top of the modal.
   */
  .dest-menu {
    position: fixed;
    z-index: 250;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    padding: 0.3rem;
    overflow-y: auto;
  }

  .dest-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    background: none;
    border: none;
    padding: 0.4rem 0.55rem;
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
  }

  .dest-item:hover {
    background: var(--bg);
  }

  .dest-item.selected {
    background: color-mix(in srgb, var(--accent) 14%, var(--surface) 86%);
    color: var(--accent);
    font-weight: 600;
  }

  .dest-item.nested {
    padding-left: 1.5rem;
  }

  .dest-group-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.55rem 0.2rem;
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .dest-empty {
    padding: 0.75rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: center;
    text-align: center;
  }

  .dest-empty-title {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text);
    font-weight: 600;
  }

  .dest-empty-hint {
    margin: 0;
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  /*
   * Inline CTA styled as a compact accent button — mirrors the Fab/primary
   * button look but sized to fit inside the dropdown without dominating it.
   * Kept tap-target friendly on mobile (36px min height) so it works as the
   * only escape hatch from the empty state.
   */
  .dest-empty-cta {
    margin-top: 0.2rem;
    padding: 0.4rem 0.8rem;
    min-height: 36px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .dest-empty-cta:hover {
    filter: brightness(1.05);
  }

  .dest-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--accent);
  }

  .dest-dot.inbox {
    background: var(--accent);
  }

  .error {
    color: #ef4444;
    font-size: 0.8rem;
    margin: 0;
  }

  .recorder {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .recorder audio {
    flex: 1;
    height: 36px;
  }

  .rec-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ef4444;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .rec-timer {
    font-size: 1rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }

  .rec-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .rec-btn:hover {
    border-color: var(--accent);
  }

  .rec-start {
    border-color: var(--accent);
    color: var(--accent);
  }

  .rec-stop {
    border-color: #ef4444;
    color: #ef4444;
  }

  .rec-discard {
    font-size: 0.75rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .transcript-status {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
    font-style: italic;
  }

  .transcript {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    white-space: pre-wrap;
    margin: 0;
  }

  .field-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .editor-tabs {
    display: flex;
    gap: 0.25rem;
  }

  .tab {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-sm);
    font-size: 0.7rem;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .tab:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }

  .tab.active {
    color: var(--accent);
    border-color: var(--accent);
  }

  .note-editor-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .markdown-body {
    font-size: 0.9rem;
    color: var(--text);
    line-height: 1.6;
    word-break: break-word;
  }

  .markdown-body :global(h1) { font-size: 1.3rem; font-weight: 600; margin: 0.75rem 0 0.4rem; }
  .markdown-body :global(h2) { font-size: 1.15rem; font-weight: 600; margin: 0.6rem 0 0.35rem; }
  .markdown-body :global(h3) { font-size: 1.05rem; font-weight: 600; margin: 0.5rem 0 0.3rem; }
  .markdown-body :global(p) { margin: 0 0 0.5rem; }
  .markdown-body :global(p:last-child) { margin-bottom: 0; }
  .markdown-body :global(ul),
  .markdown-body :global(ol) { padding-left: 1.5rem; margin: 0 0 0.5rem; }
  .markdown-body :global(ul) { list-style: disc; }
  .markdown-body :global(ol) { list-style: decimal; }
  .markdown-body :global(li) { margin-bottom: 0.15rem; }
  .markdown-body :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 0.75rem;
    margin: 0 0 0.5rem;
    color: var(--text-muted);
  }
  .markdown-body :global(a) { color: var(--accent); text-decoration: none; }
  .markdown-body :global(a:hover) { text-decoration: underline; }
  .markdown-body :global(code) {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.82rem;
  }
  .markdown-body :global(pre) {
    background: #0d1117;
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    margin: 0 0 0.5rem;
    overflow-x: auto;
  }
  .markdown-body :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: #e6edf3;
  }
  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.75rem 0;
  }
  .markdown-body :global(strong) { font-weight: 600; }
  .markdown-body :global(em) { font-style: italic; }
</style>
