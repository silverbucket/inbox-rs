<script lang="ts">
  import type { EmailItem, InboxItem } from '@inbox-rs/rs-module';
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

  const isEdit = !!editItem;

  let title = $state(editItem?.title ?? '');
  let body = $state(editItem && 'body' in editItem ? (editItem.body ?? '') : '');
  let from = $state(editItem && 'from' in editItem ? (editItem.from ?? '') : '');
  let notes = $state(editItem && 'notes' in editItem ? (editItem.notes ?? '') : '');

  $effect(() => {
    canSubmit = !!body;
  });

  buildItem = ({ id, createdAt }: BuildItemContext): BuildItemResult => {
    // Preserve the mid: URI when editing — this links the captured email
    // back to the user's mail client and isn't surfaced in the form.
    const emailMessageUrl =
      isEdit && editItem?.type === 'email' ? editItem?.messageUrl : undefined;
    const item: EmailItem = {
      id,
      type: 'email',
      title: title || 'Untitled email',
      body,
      from: from || undefined,
      notes: notes || undefined,
      messageUrl: emailMessageUrl,
      createdAt,
    };
    return { item };
  };
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
