<script lang="ts">
  import { trapFocus } from '../lib/actions';
  import { modLabel } from '../lib/platform';

  let { onclose }: { onclose: () => void } = $props();
  const mod = modLabel();

  const sections = [
    {
      title: 'Available anywhere',
      shortcuts: [
        { keys: [`${mod} K`], label: 'Search everything' },
        { keys: [`${mod} ⇧ P`], label: 'Open command palette' },
        { keys: [`${mod} ,`], label: 'Open settings' },
        { keys: [`${mod} /`], label: 'Show these shortcuts' },
      ],
    },
    {
      title: 'Quick entry',
      shortcuts: [
        { keys: ['Enter'], label: 'Save the quick entry' },
        { keys: [`${mod} Enter`], label: 'Open the full editor' },
        { keys: ['Esc'], label: 'Close a dialog' },
      ],
    },
  ];

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    onclose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div
    class="modal"
    use:trapFocus
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="shortcut-help-title"
    onclick={(e) => e.stopPropagation()}
  >
    <header>
      <div>
        <p class="eyebrow">Quick help</p>
        <h2 id="shortcut-help-title">Keyboard shortcuts</h2>
      </div>
      <button class="close" type="button" aria-label="Close keyboard shortcuts" onclick={onclose}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </header>

    <div class="sections">
      {#each sections as section (section.title)}
        <section class="shortcut-section">
          <h3>{section.title}</h3>
          <dl>
            {#each section.shortcuts as shortcut (shortcut.label)}
              <div class="shortcut-row">
                <dt>
                  {#each shortcut.keys as key, index (`${key}-${index}`)}
                    {#if index > 0}<span class="then">then</span>{/if}
                    <kbd>{key}</kbd>
                  {/each}
                </dt>
                <dd>{shortcut.label}</dd>
              </div>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
    <p class="note">Shortcuts work while a quick-entry field is focused.</p>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 1.25rem; background: var(--overlay); backdrop-filter: blur(4px); }
  .modal { width: min(680px, 100%); max-height: min(760px, calc(100dvh - 2.5rem)); overflow: auto; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); box-shadow: 0 24px 70px var(--shadow); }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1.4rem 1.5rem 1.1rem; border-bottom: 1px solid var(--border); }
  .eyebrow { margin-bottom: 0.15rem; color: var(--accent); font-size: 0.72rem; font-weight: 750; letter-spacing: 0.09em; text-transform: uppercase; }
  h2 { font-size: 1.3rem; line-height: 1.25; }
  .close { display: grid; place-items: center; width: 36px; height: 36px; flex: none; padding: 0; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text-muted); }
  .close:hover { background: var(--surface-hover); color: var(--text); }
  .close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.4rem 2rem; padding: 1.4rem 1.5rem; }
  .shortcut-section:last-child { grid-column: 1 / -1; }
  h3 { margin-bottom: 0.55rem; color: var(--text-muted); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
  dl { display: grid; gap: 0.25rem; }
  .shortcut-row { display: grid; grid-template-columns: minmax(125px, auto) 1fr; align-items: center; gap: 1rem; min-height: 2.35rem; }
  dt { display: flex; align-items: center; gap: 0.35rem; }
  dd { color: var(--text); font-size: 0.92rem; }
  kbd { min-width: 1.75rem; padding: 0.22rem 0.45rem; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 6px; background: var(--bg); color: var(--text); font: 650 0.78rem/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center; white-space: nowrap; }
  .then { color: var(--text-muted); font-size: 0.68rem; }
  .note { margin: 0 1.5rem; padding: 1rem 0 1.3rem; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.82rem; }
  @media (max-width: 600px) { .backdrop { padding: 0; place-items: end center; } .modal { max-height: 88dvh; border-radius: 18px 18px 0 0; border-bottom: 0; } .sections { grid-template-columns: 1fr; gap: 1.25rem; } .shortcut-section:last-child { grid-column: auto; } }
</style>
