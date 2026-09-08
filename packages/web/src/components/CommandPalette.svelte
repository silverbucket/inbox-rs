<script lang="ts">
  import { trapFocus } from '../lib/actions';

  type Command = {
    id: string;
    label: string;
    hint: string;
    keywords?: string;
  };

  let {
    commands,
    onrun,
    onclose,
  }: {
    commands: Command[];
    onrun: (id: string) => void;
    onclose: () => void;
  } = $props();

  let query = $state('');
  let selected = $state(0);
  const matches = $derived(
    commands.filter((command) =>
      `${command.label} ${command.keywords ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );

  function run(command: Command | undefined) {
    if (command) onrun(command.id);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (matches.length === 0) return;
      const direction = e.key === 'ArrowDown' ? 1 : -1;
      selected = (selected + direction + matches.length) % matches.length;
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      run(matches[selected]);
    }
  }

  function updateQuery(value: string) {
    query = value;
    selected = 0;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div
    class="palette"
    use:trapFocus
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="Command palette"
    onclick={(e) => e.stopPropagation()}
    onkeydown={handleKeydown}
  >
    <div class="search-row">
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input
        type="text"
        aria-label="Find a command"
        placeholder="Type a command…"
        value={query}
        oninput={(e) => updateQuery(e.currentTarget.value)}
      />
      <kbd>Esc</kbd>
    </div>

    <div class="results" aria-label="Commands">
      {#each matches as command, index (command.id)}
        <button
          type="button"
          aria-current={index === selected ? 'true' : undefined}
          class:selected={index === selected}
          onmouseenter={() => (selected = index)}
          onclick={() => run(command)}
        >
          <span>{command.label}</span>
          <span class="hint">{command.hint}</span>
        </button>
      {:else}
        <p class="empty">No matching command</p>
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1100; display: grid; place-items: start center; padding: min(16vh, 8rem) 1rem 1rem; background: var(--overlay); backdrop-filter: blur(4px); }
  .palette { width: min(580px, 100%); overflow: hidden; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: 0 24px 70px var(--shadow); }
  .search-row { display: flex; align-items: center; gap: 0.7rem; padding: 0.8rem 0.9rem; border-bottom: 1px solid var(--border); color: var(--text-muted); }
  input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 1rem; }
  input::placeholder { color: var(--text-muted); }
  kbd { padding: 0.2rem 0.4rem; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 5px; background: var(--bg); color: var(--text-muted); font: 600 0.7rem/1.2 ui-monospace, monospace; }
  .results { max-height: min(420px, 55vh); overflow: auto; padding: 0.4rem; }
  .results button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.65rem 0.75rem; border: 0; border-radius: 8px; background: transparent; color: var(--text); font-size: 0.92rem; text-align: left; }
  .results button.selected { background: var(--accent-subtler); }
  .hint { color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; }
  .empty { padding: 1.5rem 0.75rem; color: var(--text-muted); text-align: center; }
  @media (max-width: 600px) { .backdrop { padding-top: 4rem; } }
</style>
