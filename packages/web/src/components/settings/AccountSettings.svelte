<script lang="ts">
  import { tick } from 'svelte';
  import rs from '../../lib/rs';
  import { connected, syncing, userAddress, userSettings, updateUserSettings } from '../../lib/stores';
  let { focusConnect = false }: { focusConnect?: boolean } = $props();
  let address = $state(''); let connecting = $state(false); let connectInput = $state<HTMLInputElement|null>(null);
  const localPart = $derived($userAddress.split('@')[0] ?? '');
  const auto = $derived(localPart.length > 1 ? `${localPart[0]}${localPart.at(-1)}`.toUpperCase() : localPart.toUpperCase() || '?');
  let initials = $state('');
  $effect(() => { if (!initials) initials = $userSettings.abbreviation ?? ''; });
  $effect(() => { if (!$connected && !address) address = $userAddress; });
  $effect(() => { if (focusConnect && !$connected) void tick().then(() => connectInput?.focus()); });
  $effect(() => {
    if ($connected) connecting = false;
  });
  $effect(() => {
    const handleConnectionError = () => {
      connecting = false;
    };
    rs.on('error', handleConnectionError);
    return () => rs.removeEventListener('error', handleConnectionError);
  });
  function connect(){
    const value = address.trim();
    if(!value) return;
    connecting=true;
    try{
      localStorage.setItem('inbox-rs:userAddress',value);
    }catch{}
    try {
      rs.connect(value);
    } catch {
      connecting = false;
    }
  }
  function saveInitials(){ const value=initials.trim().toUpperCase().slice(0,3); initials=value; if($connected) void updateUserSettings({abbreviation:value||undefined}); }
</script>
<div class="settings-section">
{#if $connected}
  <div class="row identity wide"><div class="account-avatar">{$userSettings.abbreviation || auto}</div><div class="row-main"><div class="row-label">{$userAddress}</div><div class="row-desc">Your inbox lives on your own remoteStorage server. Inbox RS never holds a copy.</div></div><div class="row-ctl"><span class="pill ok">{$syncing?'Syncing…':'Synced'}</span></div></div>
  <div class="row"><div class="row-main"><div class="row-label">Initials</div><div class="row-desc">Two or three letters for your avatar. Defaults to your address.</div></div><div class="row-ctl"><input class="field initials" aria-label="Initials" maxlength="3" bind:value={initials} onblur={saveInitials}/></div></div>
  <div class="row"><div class="row-main"><div class="row-label">Sign out of this browser</div><div class="row-desc">Removes the local copy. Everything stays on your storage server.</div></div><div class="row-ctl"><button class="btn danger" type="button" onclick={() => rs.disconnect()}>Disconnect</button></div></div>
{:else}
  <form class="row wide" onsubmit={(e)=>{e.preventDefault();connect()}}><div class="row-main"><div class="row-label">Connect your storage</div><div class="row-desc">Your inbox lives on your own remoteStorage server. Inbox RS never holds a copy.</div></div><div class="row-ctl connect"><input class="field" aria-label="Storage address" bind:this={connectInput} bind:value={address} placeholder="user@storage.example"/><button type="submit" class="btn primary" disabled={connecting||!address.trim()}>{connecting?'Connecting…':'Connect'}</button></div></form>
{/if}</div>
<style>.account-avatar{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--accent-subtle);color:var(--accent);font-weight:700}.initials{width:72px;text-align:center;text-transform:uppercase}.connect{width:min(25rem,100%)}.connect .field{flex:1}</style>
