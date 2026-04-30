<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import type { BuildItemFn } from '../../lib/add-entry-modal';
  import { buildEmailItem } from '../../lib/build-item';

  let {
    editItem,
    canSubmit = $bindable(false),
    buildItem = $bindable(),
  }: {
    editItem?: InboxItem;
    canSubmit?: boolean;
    buildItem?: BuildItemFn;
  } = $props();

  let title = $state(editItem?.title ?? '');
  let body = $state(editItem && 'body' in editItem ? (editItem.body ?? '') : '');
  let from = $state(editItem && 'from' in editItem ? (editItem.from ?? '') : '');
  let notes = $state(editItem && 'notes' in editItem ? (editItem.notes ?? '') : '');

  $effect(() => {
    canSubmit = !!body;
  });

  buildItem = ({ id, createdAt, editItem: ctxEditItem }) =>
    buildEmailItem(
      { id, createdAt, editItem: ctxEditItem },
      { title, body, from, notes },
    );
</script>

<label class="field">
  <span>Subject</span>
  <input
    use:autofocus
    type="text"
    bind:value={title}
    placeholder="Email subject"
  />
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
  <textarea bind:value={notes} rows="2" placeholder="Optional notes..."
  ></textarea>
</label>
