<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import type { BuildItemFn } from '../../lib/add-entry-modal';
  import { buildImageItem } from '../../lib/build-item';
  import MarkdownContentField from './MarkdownContentField.svelte';

  let {
    editItem,
    prefillFile = undefined,
    canSubmit = $bindable(false),
    draftTitle = $bindable(''),
    buildItem = $bindable(),
  }: {
    editItem?: InboxItem;
    prefillFile?: File;
    canSubmit?: boolean;
    draftTitle?: string;
    buildItem?: BuildItemFn;
  } = $props();

  const hasExistingFile = !!(
    editItem &&
    'filePath' in editItem &&
    editItem.filePath
  );

  let title = $state(editItem?.title ?? '');

  // Mirror the draft title up to the shell so the filing picker can
  // surface name-match suggestions for the not-yet-saved item.
  $effect(() => {
    draftTitle = title;
  });
  let description = $state(editItem?.description ?? '');
  let body = $state(editItem?.type === 'image' ? (editItem.body ?? '') : '');
  // Seed from a file already chosen in the capture bar's picker, so the modal
  // opens with it attached (the native input can't be set programmatically —
  // the selected name is shown below instead).
  let file = $state<File | null>(prefillFile ?? null);

  // Save needs either a freshly picked file or, in edit mode, an already-
  // stored image whose metadata we're updating without replacing the bytes.
  $effect(() => {
    canSubmit = !!file || hasExistingFile;
  });

  function handleFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    file = input.files?.[0] ?? null;
  }

  // The whole form takes a dropped image, not just the small file input.
  let dragOver = $state(false);

  function handleDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    dragOver = true;
  }

  function handleDragLeave(e: DragEvent) {
    if ((e.currentTarget as Node).contains(e.relatedTarget as Node | null)) return;
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    dragOver = false;
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    const dropped = Array.from(e.dataTransfer.files).find((f) =>
      f.type.startsWith('image/'),
    );
    if (dropped) file = dropped;
  }

  buildItem = ({ id, createdAt, editItem: ctxEditItem }) =>
    buildImageItem(
      { id, createdAt, editItem: ctxEditItem },
      { title, description, file, body },
    );
</script>

<div
  class="image-form"
  class:drag-over={dragOver}
  role="group"
  aria-label="Image"
  ondragovercapture={handleDragOver}
  ondragleave={handleDragLeave}
  ondropcapture={handleDrop}
>
<label class="field">
  <span>{file ? 'Replace image' : hasExistingFile ? 'Replace image' : 'Image *'}</span>
  {#if file}
    <span class="picked">{file.name}</span>
  {/if}
  <input type="file" accept="image/*" onchange={handleFileChange} />
  <span class="drop-hint">or drop an image anywhere here</span>
</label>
<label class="field">
  <span>Title</span>
  <input use:autofocus type="text" bind:value={title} placeholder="Image title" />
</label>
<label class="field">
  <span>Description</span>
  <textarea bind:value={description} rows="2" placeholder="Optional description..."
  ></textarea>
</label>
<MarkdownContentField
  bind:value={body}
  label="Notes"
  placeholder="Add notes about this image…"
/>
</div>

<style>
  .image-form {
    border-radius: 10px;
  }
  .image-form.drag-over {
    outline: 2px dashed var(--accent);
    outline-offset: 4px;
  }
  .drop-hint {
    font-weight: 400;
  }
</style>
