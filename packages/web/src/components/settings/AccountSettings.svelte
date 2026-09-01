<script lang="ts">
  import { tick } from 'svelte';
  import rs from '../../lib/rs';
  import { LOCAL_SOCKETHUB_URL_KEY } from '../../lib/enrich';
  import { DEFAULT_SOCKETHUB_ENDPOINT } from '../../lib/link-metadata';
  import { connected, syncing, userAddress, userSettings, updateUserSettings } from '../../lib/stores';
  let { focusConnect = false }: { focusConnect?: boolean } = $props();
  const readLocal=(k:string)=>{try{return localStorage.getItem(k)}catch{return null}}; const writeLocal=(k:string,v:string)=>{try{localStorage.setItem(k,v)}catch{}}; const removeLocal=(k:string)=>{try{localStorage.removeItem(k)}catch{}};
  let sockethubCustom=$state(!!($userSettings.sockethubUrl??readLocal(LOCAL_SOCKETHUB_URL_KEY))); let sockethubEndpoint=$state($userSettings.sockethubUrl??readLocal(LOCAL_SOCKETHUB_URL_KEY)??'');
  const defaultSockethubHost=(()=>{try{return new URL(DEFAULT_SOCKETHUB_ENDPOINT).host}catch{return DEFAULT_SOCKETHUB_ENDPOINT}})();
  function useDefaultSockethub(){sockethubCustom=false;sockethubEndpoint='';removeLocal(LOCAL_SOCKETHUB_URL_KEY);if($connected)void updateUserSettings({sockethubUrl:undefined})}
  function saveSockethub(){const v=sockethubEndpoint.trim();writeLocal(LOCAL_SOCKETHUB_URL_KEY,v);if($connected)void updateUserSettings({sockethubUrl:v||undefined})}
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
  <div class="row identity wide"><div class="account-avatar">{$userSettings.abbreviation || auto}</div><div class="row-main"><div class="row-label">{$userAddress}</div><div class="row-desc">Your inbox lives on your own <a href="https://remotestorage.io" target="_blank" rel="noreferrer">remoteStorage</a> server. Inbox RS never holds a copy.</div></div><div class="row-ctl"><span class="pill ok">{$syncing?'Syncing…':'Synced'}</span></div></div>
  <div class="row"><div class="row-main"><div class="row-label">Initials</div><div class="row-desc">Two or three letters for your avatar. Defaults to your address.</div></div><div class="row-ctl"><input class="field initials" aria-label="Initials" maxlength="3" bind:value={initials} onblur={saveInitials}/></div></div>
  <div class="row"><div class="row-main"><div class="row-label">Sign out of this browser</div><div class="row-desc">Removes the local copy. Everything stays on your storage server.</div></div><div class="row-ctl"><button class="btn danger" type="button" onclick={() => rs.disconnect()}>Disconnect</button></div></div>
{:else}
  <form class="row wide" onsubmit={(e)=>{e.preventDefault();connect()}}><div class="row-main"><div class="row-label">Connect your storage</div><div class="row-desc">Your inbox lives on your own <a href="https://remotestorage.io" target="_blank" rel="noreferrer">remoteStorage</a> server, an open standard — Inbox RS never holds a copy. New to remoteStorage? <a href="https://remotestorage.io/get.html" target="_blank" rel="noreferrer">Get a storage account</a>.</div></div><div class="row-ctl connect"><input class="field" aria-label="Storage address" bind:this={connectInput} bind:value={address} placeholder="user@storage.example"/><button type="submit" class="btn primary" disabled={connecting||!address.trim()}>{connecting?'Connecting…':'Connect'}</button></div></form>
{/if}
<div class="row stack"><div class="row-main"><div class="row-label">Sockethub</div><div class="row-desc">The open, multi-protocol relay behind link previews and CalDAV calendar sync — it does the fetching so your browser and the sites/servers you connect to never talk directly. Requires a Sockethub 5.0 alpha release or later with HTTP actions enabled.</div></div><div class="row-ctl"><div class="seg"><button type="button" class:on={!sockethubCustom} onclick={useDefaultSockethub}>Default</button><button type="button" class:on={sockethubCustom} onclick={()=>sockethubCustom=true}>My own server</button></div>{#if sockethubCustom}<div class="nested"><label for="sockethub-endpoint">Endpoint</label><input id="sockethub-endpoint" class="field mono" type="url" bind:value={sockethubEndpoint} placeholder="https://sockethub.example.com/sockethub-http" onblur={saveSockethub}/></div>{:else}<div class="nested">Runs at <code>{defaultSockethubHost}</code>, hosted by Inbox RS's author as a free service — see <a href="https://silverbucket.net" target="_blank" rel="noreferrer">silverbucket.net</a>.</div>{/if}</div></div>
</div>
<style>.account-avatar{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--accent-subtle);color:var(--accent);font-weight:700}.initials{width:72px;text-align:center;text-transform:uppercase}.connect{width:min(25rem,100%)}.connect .field{flex:1}.nested{margin-top:.6rem;padding:.75rem .9rem;border-left:2px solid var(--accent-line);background:var(--bg);border-radius:0 var(--radius-sm) var(--radius-sm) 0}.nested label{display:block;margin-bottom:.4rem;font-size:.76rem;color:var(--text-muted)}</style>
