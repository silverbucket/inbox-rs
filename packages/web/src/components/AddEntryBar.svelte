<script lang="ts">
  import type { InboxItemType } from '@inbox-rs/rs-module';
  import { typeIconPath } from '../lib/item-utils';

  let { onadd, excludeTypes = [] }: {
    /** Called with the chosen item type. Destination is chosen inside the modal. */
    onadd: (type: InboxItemType) => void;
    /** Types to omit from the strip. Useful in contexts where a specific type
        is handled separately — e.g. collection views hide 'todo' because the
        collection's own Todos section has its own add affordance. */
    excludeTypes?: InboxItemType[];
  } = $props();

  const allButtons: { type: InboxItemType; label: string }[] = [
    { type: 'note',     label: 'Note'     },
    { type: 'todo',     label: 'Todo'     },
    { type: 'bookmark', label: 'Bookmark' },
    { type: 'image',    label: 'Image'    },
    { type: 'audio',    label: 'Audio'    },
    { type: 'document', label: 'File'     },
  ];

  const buttons = $derived(allButtons.filter(b => !excludeTypes.includes(b.type)));
</script>

<!--
  Horizontal scrolling strip of type buttons — buttons stay on a single line
  and never wrap, so no "+" ends up orphaned on its own row.
-->
<div class="add-strip">
  {#each buttons as btn}
    <button type="button" class="add-btn" onclick={() => onadd(btn.type)} title={`Add ${btn.label}`}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        {@html typeIconPath(btn.type)}
      </svg>
      <span>{btn.label}</span>
    </button>
  {/each}
</div>

<style>
  .add-strip {
    display: flex;
    justify-content: center;
    gap: 0.4rem;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: thin;
    padding-bottom: 0.15rem; /* room for scrollbar on macOS */
  }

  /* When the strip overflows, the scroll container still needs left-alignment
     otherwise flexbox centering clips the first buttons. */
  .add-strip > :first-child {
    margin-left: auto;
  }
  .add-strip > :last-child {
    margin-right: auto;
  }

  .add-strip::-webkit-scrollbar {
    height: 4px;
  }

  .add-strip::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 2px;
  }

  .add-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.7rem;
    color: var(--text-muted);
    font-size: 0.8rem;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .add-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  @media (max-width: 520px) {
    .add-btn span {
      display: none;
    }

    .add-btn {
      padding: 0.4rem 0.55rem;
    }
  }
</style>
