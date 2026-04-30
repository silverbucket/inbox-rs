<script lang="ts">
  import type { DocumentItem, InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import {
    type BuildItemContext,
    type BuildItemFn,
    type BuildItemResult,
    getFileExtension,
  } from '../../lib/add-entry-modal';

  let {
    editItem,
    canSubmit = $bindable(false),
    buildItem = $bindable(),
  }: {
    editItem?: InboxItem;
    canSubmit?: boolean;
    buildItem?: BuildItemFn;
  } = $props();

  const isEdit = !!editItem;
  const hasExistingFile = !!(
    editItem &&
    'filePath' in editItem &&
    editItem.filePath
  );

  let title = $state(editItem?.title ?? '');
  let description = $state(editItem?.description ?? '');
  let file = $state<File | null>(null);

  $effect(() => {
    canSubmit = !!file || hasExistingFile;
  });

  function handleFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    file = input.files?.[0] ?? null;
  }

  buildItem = async ({
    id,
    createdAt,
  }: BuildItemContext): Promise<BuildItemResult | null> => {
    if (file) {
      const existingPath =
        isEdit && editItem?.type === 'document' ? editItem?.filePath : undefined;
      const ext = getFileExtension(file.name);
      const filePath = existingPath || `files/${id}${ext}`;
      const fileData = await file.arrayBuffer();
      const item: DocumentItem = {
        id,
        type: 'document',
        title: title || file.name,
        filePath,
        mimeType: file.type,
        fileSize: file.size,
        fileName: file.name,
        description: description || undefined,
        createdAt,
      };
      return { item, fileData };
    }
    if (editItem && editItem.type === 'document') {
      const item: DocumentItem = {
        ...editItem,
        title: title || editItem.title,
        description: description || undefined,
      };
      return { item };
    }
    return null;
  };
</script>

<label class="field">
  <span>{hasExistingFile ? 'Replace file' : 'File *'}</span>
  <input type="file" onchange={handleFileChange} />
</label>
<label class="field">
  <span>Title</span>
  <input
    use:autofocus
    type="text"
    bind:value={title}
    placeholder="Document title"
  />
</label>
<label class="field">
  <span>Description</span>
  <textarea
    bind:value={description}
    rows="2"
    placeholder="Optional description..."
  ></textarea>
</label>
