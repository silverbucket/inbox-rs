<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import type { BuildItemFn } from '../../lib/add-entry-modal';
  import { buildBookmarkItem } from '../../lib/build-item';

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
  // clicks Save. Item-shaping rules live in the pure builder so they can
  // be unit-tested without mounting this component.
  buildItem = ({ id, createdAt, editItem: ctxEditItem }) =>
    buildBookmarkItem(
      { id, createdAt, editItem: ctxEditItem },
      { url, title, description },
    );
</script>

<p class="info-note">
  Fields left blank are filled automatically from the page's metadata
  (title, description, preview image) after saving.
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
