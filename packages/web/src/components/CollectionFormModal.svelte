<script lang="ts">
  import type { Collection, CollectionGroup } from '@inbox-rs/rs-module';
  import { get } from 'svelte/store';
  import { appConfig, groups, sortedGroups, storeGroup, updateConfig } from '../lib/stores';
  import EntityFormModal from './EntityFormModal.svelte';
  import { randomPresetColor } from '../lib/constants';

  let { collection = undefined, groupId = undefined, onclose, onsave, ondelete = undefined, onarchive = undefined }: {
    collection?: Collection;
    /** Pre-selected group for the create path — e.g. when the user clicks
        "Add collection" inside a specific GroupSection. Ignored in edit mode
        (the collection's own groupId is authoritative there). */
    groupId?: string;
    onclose: () => void;
    onsave: (col: Collection) => void;
    ondelete?: () => void;
    onarchive?: () => void;
  } = $props();

  const isEdit = $derived(!!collection);

  let name = $state(collection?.name ?? '');
  let description = $state(collection?.description ?? '');
  let color = $state(collection?.color ?? randomPresetColor());
  let offPlan = $state(!!collection?.offPlan);

  /**
   * Pick the initial group selection for the picker. Resolution order:
   *   1. Editing an existing collection → its current groupId.
   *   2. Caller passed a `groupId` (e.g. "Add collection" inside a specific
   *      group section) → honor that explicit context.
   *   3. `lastSelectedGroupId` from appConfig, validated against the current
   *      groups store — the referenced group may have been deleted since the
   *      last save, in which case we ignore it and fall through.
   *   4. First group in display order — a sensible default so the picker is
   *      never empty when groups exist.
   *   5. Empty string — only when there are no groups at all; the form
   *      then asks for a new group name instead (see `creatingNewGroup`).
   *
   * Resolved once at mount time via `get()`; reactive re-evaluation would
   * fight the user's subsequent manual selection.
   */
  function pickInitialGroupId(): string {
    if (collection?.groupId) return collection.groupId;
    if (groupId) return groupId;
    const ordered = get(sortedGroups);
    const activeIds = new Set(ordered.map((group) => group.id));
    const last = get(appConfig).lastSelectedGroupId;
    if (last && activeIds.has(last)) return last;
    return ordered[0]?.id ?? '';
  }

  let selectedGroupId = $state<string>(pickInitialGroupId());

  const hasGroups = $derived($sortedGroups.length > 0);
  // Every collection belongs to a group, so with none yet the form creates
  // one inline (same pattern as CollectionPicker) rather than sending the
  // user elsewhere. With groups, the user can opt into a new one.
  let wantsNewGroup = $state(false);
  let newGroupName = $state('');
  let saving = $state(false);
  let saveError = $state('');
  const creatingNewGroup = $derived(!isEdit && (!hasGroups || wantsNewGroup));
  const groupValid = $derived(
    !!selectedGroupId &&
      !!$groups[selectedGroupId] &&
      !$groups[selectedGroupId].archived,
  );
  const canSubmit = $derived(
    !saving && (creatingNewGroup ? !!newGroupName.trim() : groupValid),
  );
  const submitHint = $derived(
    saving
      ? ''
      : creatingNewGroup
        ? 'Name the new group to create this collection in.'
        : groupValid
          ? ''
          : 'Choose a group for this collection.',
  );

  // Fixed up front so a new group can be written already listing it: adding it
  // in a second write right after the first 412s and drops the link.
  const collectionId = collection?.id ?? crypto.randomUUID();

  async function handleSubmit() {
    if (!name.trim() || !canSubmit) return;
    let destinationGroupId = selectedGroupId;
    if (creatingNewGroup) {
      saving = true;
      saveError = '';
      const group: CollectionGroup = {
        id: crypto.randomUUID(),
        name: newGroupName.trim(),
        collectionIds: [collectionId],
        createdAt: new Date().toISOString(),
        color: randomPresetColor(),
      };
      try {
        await storeGroup(group);
      } catch (e) {
        console.error('Failed to create group', e);
        saveError = e instanceof Error ? e.message : 'Failed to create group';
        saving = false;
        return;
      }
      destinationGroupId = group.id;
      // A retry after a failed collection save must not make a second group.
      selectedGroupId = group.id;
      wantsNewGroup = false;
      newGroupName = '';
      saving = false;
    }
    // Persist the picked group as the next default before the parent's
    // onsave runs. Best-effort: if the write fails the user's creation
    // still succeeds, they just lose the preference memory this once.
    if (!isEdit) {
      try {
        await updateConfig({ lastSelectedGroupId: destinationGroupId });
      } catch (e) {
        console.error('Failed to persist lastSelectedGroupId', e);
      }
    }
    // Start from the existing collection so fields this form doesn't edit
    // (board set, plan column, archive state) survive an edit.
    const saved: Collection = {
      ...(collection ?? {}),
      id: collectionId,
      name: name.trim(),
      description: description.trim() || undefined,
      itemIds: collection?.itemIds ?? [],
      createdAt: collection?.createdAt ?? new Date().toISOString(),
      color,
      groupId: destinationGroupId,
    } as Collection;
    if (offPlan) saved.offPlan = true;
    else {
      delete saved.offPlan;
      delete saved.planColumnId;
    }
    onsave(saved);
  }
</script>

<EntityFormModal
  entityName="Collection"
  {isEdit}
  bind:name
  bind:color
  showDescription
  bind:description
  namePlaceholder="e.g. Reading List"
  descriptionPlaceholder="What's this collection for?"
  maxWidth="440px"
  {onclose}
  onsubmit={handleSubmit}
  {ondelete}
  {onarchive}
  extraFields={groupField}
  {canSubmit}
  {submitHint}
/>

{#snippet groupField()}
  <div class="field">
    {#if creatingNewGroup}
      <label class="label" for="collection-new-group">
        {hasGroups ? 'New group' : 'Group — every collection lives in one'}
      </label>
      <input
        id="collection-new-group"
        type="text"
        bind:value={newGroupName}
        placeholder="e.g. Personal"
        aria-label="New group name"
      />
      {#if hasGroups}
        <button type="button" class="group-switch" onclick={() => (wantsNewGroup = false)}>
          Choose an existing group
        </button>
      {/if}
    {:else}
      <label class="label" for="collection-group">Group</label>
      <select id="collection-group" bind:value={selectedGroupId} required>
        {#each $sortedGroups as g (g.id)}
          <option value={g.id}>{g.name}</option>
        {/each}
      </select>
      {#if !isEdit}
        <button type="button" class="group-switch" onclick={() => (wantsNewGroup = true)}>
          Create a new group
        </button>
      {/if}
    {/if}
    {#if saveError}
      <p class="error" role="status">{saveError}</p>
    {/if}
  </div>
  <label class="check">
    <input type="checkbox" bind:checked={offPlan} />
    <span>
      <span class="check-title">It's a list</span>
      <span class="check-hint">Like Movies or a reading list: its todos stay off the Todos plan.</span>
    </span>
  </label>
{/snippet}

<style>
  /* Mirror the input styling from EntityFormModal so the select blends in
     with the other form fields. Svelte scopes these classes to snippet
     content rendered from this component, which is why the duplication is
     intentional — EntityFormModal's styles don't reach across the snippet
     boundary. */
  .field {
    display: block;
    margin-bottom: 0.85rem;
  }

  .label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.3rem;
  }

  select,
  input[type='text'] {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    padding: 0.5rem 0.65rem;
    /* Keep at >=1rem to avoid iOS Safari focus-zoom on touch devices. */
    font-size: 1rem;
    font-family: inherit;
    cursor: pointer;
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    margin-bottom: 0.85rem;
    cursor: pointer;
  }

  .check input {
    margin-top: 0.2rem;
    accent-color: var(--accent);
  }

  .check-title {
    display: block;
    font-weight: 600;
    font-size: 0.9rem;
  }

  .check-hint {
    display: block;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .group-switch {
    margin-top: 0.35rem;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }

  .error {
    margin: 0.35rem 0 0;
    font-size: 0.8rem;
    color: var(--danger-text);
  }

  input[type='text'] {
    cursor: text;
  }

  input[type='text']:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
  }
</style>
