<script lang="ts">
  import type { InboxItemType } from '@inbox-rs/rs-module';

  let { onadd }: {
    /** Called with the chosen item type. Destination is chosen inside the modal. */
    onadd: (type: InboxItemType) => void;
  } = $props();

  const buttons: { type: InboxItemType; label: string; icon: string }[] = [
    {
      type: 'todo',
      label: 'Todo',
      icon: '<polyline points="20 6 9 17 4 12"/>'
    },
    {
      type: 'bookmark',
      label: 'Bookmark',
      icon: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'
    },
    {
      type: 'note',
      label: 'Note',
      icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'
    },
    {
      type: 'image',
      label: 'Image',
      icon: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'
    },
    {
      type: 'audio',
      label: 'Audio',
      icon: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'
    },
    {
      type: 'document',
      label: 'File',
      icon: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'
    }
  ];
</script>

<!--
  Horizontal scrolling strip of type buttons — buttons stay on a single line
  and never wrap, so no "+" ends up orphaned on its own row.
-->
<div class="add-strip">
  {#each buttons as btn}
    <button class="add-btn" onclick={() => onadd(btn.type)} title={`Add ${btn.label}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        {@html btn.icon}
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
