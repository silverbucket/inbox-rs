<script lang="ts">
  import type { Collection } from '@inbox-rs/rs-module';
  import { get } from 'svelte/store';
  import { sortedGroups, groups, appConfig, updateConfig } from '../lib/stores';
  import EntityFormModal from './EntityFormModal.svelte';

  let { collection = undefined, groupId = undefined, onclose, onsave, ondelete = undefined }: {
    collection?: Collection;
    /** Pre-selected group for the create path — e.g. when the user clicks
        "Add collection" inside a specific GroupSection. Ignored in edit mode
        (the collection's own groupId is authoritative there). */
    groupId?: string;
    onclose: () => void;
    onsave: (col: Collection) => void;
    ondelete?: () => void;
  } = $props();

  const isEdit = $derived(!!collection);

  let name = $state(collection?.name ?? '');
  let description = $state(collection?.description ?? '');
  let color = $state(collection?.color ?? '#6366f1');

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
   *   5. Empty string — only when there are no groups at all; the submit
   *      button stays disabled until the user creates a group first.
   *
   * Resolved once at mount time via `get()`; reactive re-evaluation would
   * fight the user's subsequent manual selection.
   */
  function pickInitialGroupId(): string {
    if (collection?.groupId) return collection.groupId;
    if (groupId) return groupId;
    const allGroups = get(groups);
    const last = get(appConfig).lastSelectedGroupId;
    if (last && allGroups[last]) return last;
    const ordered = get(sortedGroups);
    return ordered[0]?.id ?? '';
  }

  let selectedGroupId = $state<string>(pickInitialGroupId());

  const hasGroups = $derived($sortedGroups.length > 0);
  const canSubmit = $derived(!!selectedGroupId);

  async function handleSubmit() {
    if (!name.trim()) return;
    if (!selectedGroupId) return;
    // Persist the picked group as the next default before the parent's
    // onsave runs. Best-effort: if the write fails the user's creation
    // still succeeds, they just lose the preference memory this once.
    if (!isEdit) {
      try {
        await updateConfig({ lastSelectedGroupId: selectedGroupId });
      } catch (e) {
        console.error('Failed to persist lastSelectedGroupId', e);
      }
    }
    onsave({
      id: collection?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || undefined,
      itemIds: collection?.itemIds ?? [],
      createdAt: collection?.createdAt ?? new Date().toISOString(),
      color,
      groupId: selectedGroupId,
    });
  }
</script>

<EntityFormModal
  entityName="Collection"
  {isEdit}
  bind:name
  bind:color
  showDescription
  bind:description
  namePlaceholder="e.g. Sockethub Bugs"
  descriptionPlaceholder="What's this collection for?"
  maxWidth="440px"
  {onclose}
  onsubmit={handleSubmit}
  {ondelete}
  extraFields={groupField}
  {canSubmit}
/>

{#snippet groupField()}
  <label class="field">
    <span class="label">Group</span>
    <select bind:value={selectedGroupId} required>
      {#if !hasGroups}
        <!-- First-run / all-groups-deleted: there's nowhere to put a new
             collection. The placeholder stays disabled so the user can't
             submit, mirroring the page-level "No groups yet" message. -->
        <option value="" disabled>No groups yet — create one in the filter bar</option>
      {:else}
        {#each $sortedGroups as g (g.id)}
          <option value={g.id}>{g.name}</option>
        {/each}
      {/if}
    </select>
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

  select {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    padding: 0.5rem 0.65rem;
    font-size: 0.9rem;
    font-family: inherit;
    cursor: pointer;
  }

  select:focus {
    outline: none;
    border-color: var(--accent);
  }
</style>
