<script lang="ts">
  import type { BookmarkItem, InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import type {
    BuildItemContext,
    BuildItemFn,
    BuildItemResult,
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

  let url = $state(editItem && 'url' in editItem ? editItem.url : '');
  let title = $state(editItem?.title ?? '');
  let description = $state(editItem?.description ?? '');

  // The URL field is the only required input — title falls back to the URL
  // and description is optional. Surface readiness to the shell so the Save
  // button can stay disabled until something useful exists.
  $effect(() => {
    canSubmit = !!url;
  });

  // Set the build function once. The closure reads the latest reactive
  // state on every call, so the shell can invoke this whenever the user
  // clicks Save.
  buildItem = ({ id, createdAt }: BuildItemContext): BuildItemResult => {
    const bookmark: BookmarkItem = {
      id,
      type: 'bookmark',
      title: title || url,
      url,
      description: description || undefined,
      createdAt,
    };
    // Preserve enrichment metadata fetched by the extension (favicon,
    // ogImage, siteName, embedded body, downloaded image) — the web form
    // doesn't surface these fields, so we'd lose them if we didn't copy
    // them through on edit.
    if (editItem && editItem.type === 'bookmark') {
      if (editItem.favicon) bookmark.favicon = editItem.favicon;
      if (editItem.ogImage) bookmark.ogImage = editItem.ogImage;
      if (editItem.siteName) bookmark.siteName = editItem.siteName;
      if (editItem.body) bookmark.body = editItem.body;
      if (editItem.filePath) bookmark.filePath = editItem.filePath;
      if (editItem.mimeType) bookmark.mimeType = editItem.mimeType;
    }
    return { item: bookmark };
  };
</script>

<p class="info-note">
  Metadata fetching is not yet available in the web app. Use the browser
  extension to auto-fill bookmark details. Sockethub integration is planned
  for a future release.
</p>
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
  <textarea bind:value={description} rows="2" placeholder="Optional note..."
  ></textarea>
</label>
