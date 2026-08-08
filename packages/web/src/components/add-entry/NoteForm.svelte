<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { autofocusIf } from '../../lib/actions';
  import type { BuildItemFn } from '../../lib/add-entry-modal';
  import { buildNoteItem } from '../../lib/build-item';
  import MarkdownContentField from './MarkdownContentField.svelte';

  let {
    editItem,
    prefillTitle = '',
    canSubmit = $bindable(false),
    draftTitle = $bindable(''),
    buildItem = $bindable(),
  }: {
    editItem?: InboxItem;
    prefillTitle?: string;
    canSubmit?: boolean;
    draftTitle?: string;
    buildItem?: BuildItemFn;
  } = $props();

  // When opened from quick-capture, the typed text seeds the title and the
  // body gets focus so the user keeps writing the content.
  let title = $state(editItem?.title ?? prefillTitle);

  // Mirror the draft title up to the shell so the filing picker can
  // surface name-match suggestions for the not-yet-saved item.
  $effect(() => {
    draftTitle = title;
  });
  let body = $state(
    editItem && 'body' in editItem ? (editItem.body ?? '') : '',
  );
  let description = $state(editItem?.description ?? '');

  // A note is captureable as soon as the user has typed a title or any body.
  $effect(() => {
    canSubmit = !!(title || body);
  });

  buildItem = ({ id, createdAt, editItem: ctxEditItem }) =>
    buildNoteItem(
      { id, createdAt, editItem: ctxEditItem },
      { title, body, description },
    );

</script>

<label class="field">
  <span>Title</span>
  <!--
    Title is autofocused for a fresh note so the user lands on a field. But
    when opened from quick-capture (prefillTitle set) the title is already
    filled, so we skip autofocusing it and let the body editor take focus
    instead (see `autofocus` on the visual editor below).
  -->
  <input use:autofocusIf={!prefillTitle} type="text" bind:value={title} placeholder="Note title" />
</label>
<MarkdownContentField bind:value={body} focusOnMount={!!prefillTitle} />
