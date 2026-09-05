<script lang="ts">
  import type { SectionId } from '../lib/settings-sections';
  import { connected, syncing, userAddress, userSettings } from '../lib/stores';

  let { onopensettings }: { onopensettings: (section?: SectionId) => void } = $props();
  const localPart = $derived($userAddress.split('@')[0] ?? '');
  const automaticInitials = $derived(localPart.length > 1
    ? `${localPart[0]}${localPart[localPart.length - 1]}`.toUpperCase()
    : localPart.toUpperCase() || '?');
  const initials = $derived($userSettings.abbreviation?.slice(0, 2) || automaticInitials);

  export async function openConnectMenu(): Promise<void> {
    onopensettings('account');
  }
</script>

<button type="button" class="trigger" onclick={() => onopensettings()} aria-haspopup="dialog"
  aria-label={$connected ? 'User menu — connected' : 'User menu — disconnected'}>
  {#if $connected && $userAddress}
    <span class="avatar" aria-hidden="true">{initials}</span>
  {:else}
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  {/if}
  <span class="status-dot" class:connected={$connected} class:syncing={$syncing}></span>
</button>

<style>
  .trigger { position: relative; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); cursor: pointer; }
  .trigger:hover { border-color: var(--accent); background: var(--accent-subtler); }
  .avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--accent-subtle); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent); font-size: 0.8rem; font-weight: 700; }
  .status-dot { position: absolute; right: -1px; bottom: 1px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--surface); background: var(--text-muted); }
  .status-dot.connected { background: var(--ok, #059669); }
  .status-dot.syncing { background: var(--accent); animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.45; } }
  @media (prefers-reduced-motion: reduce) { .status-dot.syncing { animation: none; } }
</style>
