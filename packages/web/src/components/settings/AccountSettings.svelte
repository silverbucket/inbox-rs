<script lang="ts">
  import { tick } from 'svelte';
  import rs from '../../lib/rs';
  import { LOCAL_SOCKETHUB_URL_KEY } from '../../lib/enrich';
  import { DEFAULT_SOCKETHUB_ENDPOINT, fetchSockethubInfo } from '../../lib/link-metadata';
  import { authorizationRequired, connectionStatus, connected, userAddress, userSettings, updateUserSettings } from '../../lib/stores';
  let { focusConnect = false }: { focusConnect?: boolean } = $props();
  const readLocal=(k:string)=>{try{return localStorage.getItem(k)}catch{return null}}; const writeLocal=(k:string,v:string)=>{try{localStorage.setItem(k,v)}catch{}}; const removeLocal=(k:string)=>{try{localStorage.removeItem(k)}catch{}};
  let sockethubCustom=$state(!!($userSettings.sockethubUrl??readLocal(LOCAL_SOCKETHUB_URL_KEY))); let sockethubEndpoint=$state($userSettings.sockethubUrl??readLocal(LOCAL_SOCKETHUB_URL_KEY)??'');
  const defaultSockethubHost=(()=>{try{return new URL(DEFAULT_SOCKETHUB_ENDPOINT).host}catch{return DEFAULT_SOCKETHUB_ENDPOINT}})();
  type SockethubStatus = 'loading' | 'reported' | 'unsupported' | 'unreachable';
  let sockethubStatus = $state<SockethubStatus>('loading');
  let sockethubApiVersion = $state<number | null>(null);
  let sockethubPlatforms = $state<Array<{ id: string; apiVersion: number }>>([]);
  let sockethubProbe = 0;
  const effectiveSockethubEndpoint = $derived(sockethubCustom ? sockethubEndpoint.trim() : DEFAULT_SOCKETHUB_ENDPOINT);
  async function loadSockethubInfo(endpoint: string, probe: number){
    try {
      const info = await fetchSockethubInfo(endpoint);
      if (probe !== sockethubProbe) return;
      sockethubApiVersion = info?.apiVersion ?? null;
      sockethubPlatforms = info?.platforms ?? [];
      sockethubStatus = info ? 'reported' : 'unsupported';
    } catch {
      if (probe === sockethubProbe) sockethubStatus = 'unreachable';
    }
  }
  function useDefaultSockethub(){sockethubCustom=false;sockethubEndpoint='';removeLocal(LOCAL_SOCKETHUB_URL_KEY);if($connected)void updateUserSettings({sockethubUrl:undefined})}
  function saveSockethub(){const v=sockethubEndpoint.trim();writeLocal(LOCAL_SOCKETHUB_URL_KEY,v);if($connected)void updateUserSettings({sockethubUrl:v||undefined})}
  // Catches a synced custom endpoint that's still loading from remoteStorage
  // when this section first renders (e.g. right after connecting on a new
  // device) — the $state above only reads $userSettings once, at mount.
  $effect(() => { const synced = $userSettings.sockethubUrl; if (synced && !sockethubCustom && !sockethubEndpoint) { sockethubCustom = true; sockethubEndpoint = synced; } });
  $effect(() => {
    const endpoint = effectiveSockethubEndpoint;
    const probe = ++sockethubProbe;
    sockethubApiVersion = null;
    sockethubPlatforms = [];
    sockethubStatus = endpoint ? 'loading' : 'unreachable';
    if (!endpoint) return;
    const timeout = window.setTimeout(() => void loadSockethubInfo(endpoint, probe), 300);
    return () => window.clearTimeout(timeout);
  });
  /** Plain-language reason + next step for the unavailable pill states. */
  const sockethubProblem = $derived(
    sockethubStatus === 'unreachable'
      ? !effectiveSockethubEndpoint
        ? 'No address yet — enter your server\'s address, or use the default.'
        : sockethubCustom
          ? 'Can\'t reach the service — check the address, or use the default.'
          : 'Can\'t reach the default service right now. Link previews and calendar sync will be missing until it\'s back.'
      : sockethubStatus === 'unsupported'
        ? sockethubCustom
          ? 'The server answered but didn\'t report a version — it may be older than Sockethub 5.0 alpha. Update it, or use the default.'
          : 'The default service answered but didn\'t report a version. Link previews may not work right now.'
        : sockethubStatus === 'reported' && !sockethubPlatforms.some((p) => p.id === 'media')
          ? 'This server can\'t download images (no media platform), so saved links only link to their preview image and lose it if the site goes away.'
          : '',
  );
  let address = $state(''); let connecting = $state(false); let connectInput = $state<HTMLInputElement|null>(null);
  let reconnectError = $state('');
  const localPart = $derived($userAddress.split('@')[0] ?? '');
  const auto = $derived(localPart.length > 1 ? `${localPart[0]}${localPart.at(-1)}`.toUpperCase() : localPart.toUpperCase() || '?');
  let initials = $state('');
  // Mirror the stored abbreviation, but only when it actually changes: the
  // store is replaced wholesale on every settings write, and an unrelated
  // update mid-edit must not clobber what the user is typing.
  let syncedAbbreviation: string | undefined;
  $effect(() => {
    const stored = ($userSettings.abbreviation ?? '').slice(0, 2);
    if (stored === syncedAbbreviation) return;
    syncedAbbreviation = stored;
    initials = stored;
  });
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
  function saveInitials(){ const value=initials.trim().toUpperCase().slice(0,2); initials=value; if($connected) void updateUserSettings({abbreviation:value||undefined}); }
  /** Keep reconnection available in Account settings without a second alert. */
  function reconnect(){
    reconnectError='';
    try { rs.reconnect(); }
    catch { reconnectError='Could not start reconnection. Please try again.'; }
  }
</script>
<div class="settings-section">
{#if $connected}
  <div class="row identity wide"><div class="account-avatar">{$userSettings.abbreviation?.slice(0, 2) || auto}</div><div class="row-main"><div class="row-label">{$userAddress}</div><div class="row-desc">Your inbox lives on your own <a href="https://remotestorage.io" target="_blank" rel="noreferrer">remoteStorage</a> server. Inbox RS never holds a copy.</div>{#if reconnectError}<p role="status">{reconnectError}</p>{/if}</div><div class="row-ctl"><span class="pill" class:ok={$connectionStatus === 'Connected'}>{$connectionStatus}</span>{#if $authorizationRequired}<button class="btn primary" type="button" onclick={reconnect}>Reconnect</button>{/if}</div></div>
  <div class="row"><div class="row-main"><div class="row-label">Initials</div><div class="row-desc">Up to two letters for your avatar. Defaults to your address.</div></div><div class="row-ctl"><input class="field initials" aria-label="Initials" maxlength="2" bind:value={initials} onblur={saveInitials}/></div></div>
  <div class="row"><div class="row-main"><div class="row-label">Sign out of this browser</div><div class="row-desc">Removes the local copy. Everything stays on your storage server.</div></div><div class="row-ctl"><button class="btn danger" type="button" onclick={() => rs.disconnect()}>Disconnect</button></div></div>
{:else}
  <form class="row wide" onsubmit={(e)=>{e.preventDefault();connect()}}><div class="row-main"><div class="row-label">Connect your storage</div><div class="row-desc">Your inbox lives on your own <a href="https://remotestorage.io" target="_blank" rel="noreferrer">remoteStorage</a> server, an open standard — Inbox RS never holds a copy. New to remoteStorage? <a href="https://remotestorage.io/get.html" target="_blank" rel="noreferrer">Get a storage account</a>.</div></div><div class="row-ctl connect"><input class="field" aria-label="Storage address" bind:this={connectInput} bind:value={address} placeholder="user@storage.example"/><button type="submit" class="btn primary" disabled={connecting||!address.trim()}>{connecting?'Connecting…':'Connect storage'}</button></div></form>
{/if}
<div class="row stack"><div class="row-main"><div class="row-label">Link preview service</div><div class="row-desc">Fetches link previews and syncs calendars without connecting your browser directly to the sites you save.</div><details class="service-details"><summary>Technical details</summary><p>This uses <a href="https://sockethub.org" target="_blank" rel="noreferrer">Sockethub</a>. Your own server needs version 5.0 alpha or later with HTTP actions enabled.</p></details></div><div class="row-ctl"><div class="seg"><button type="button" class:on={!sockethubCustom} onclick={useDefaultSockethub}>Default</button><button type="button" class:on={sockethubCustom} onclick={()=>sockethubCustom=true}>My own server</button></div>{#if sockethubCustom}<div class="nested"><label for="sockethub-endpoint">Endpoint</label><input id="sockethub-endpoint" class="field mono" type="url" bind:value={sockethubEndpoint} placeholder="https://sockethub.example.com/sockethub-http" onblur={saveSockethub}/></div>{:else}<div class="nested">Runs at <code>{defaultSockethubHost}</code>, hosted by Inbox RS's author as a free service — see <a href="https://silverbucket.net" target="_blank" rel="noreferrer">silverbucket.net</a>.</div>{/if}<div class="server-info"><code>{effectiveSockethubEndpoint}</code><span class:ok={sockethubStatus === 'reported'} class="pill">{sockethubStatus === 'loading' ? 'Checking…' : sockethubStatus === 'reported' ? `API v${sockethubApiVersion}` : sockethubStatus === 'unsupported' ? 'API version unavailable' : 'Unavailable'}</span></div>{#if sockethubProblem}<p class="server-problem" role="status">{sockethubProblem}</p>{/if}{#if sockethubPlatforms.length}<div class="platforms" aria-label="Sockethub platform API versions">{#each sockethubPlatforms as platform (platform.id)}<span><code>{platform.id}</code> API v{platform.apiVersion}</span>{/each}</div>{/if}</div></div>
</div>
<style>.account-avatar{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--accent-subtle);color:var(--accent-text);font-weight:700}.initials{width:72px;text-align:center;text-transform:uppercase}.connect{width:min(25rem,100%)}.connect .field{flex:1}.nested{margin-top:.6rem;padding:.75rem .9rem;border-left:2px solid var(--accent-line);background:var(--bg);border-radius:0 var(--radius-sm) var(--radius-sm) 0}.nested label{display:block;margin-bottom:.4rem;font-size:.76rem;color:var(--text-muted)}.server-info{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-top:.65rem;min-width:0}.server-info code{overflow-wrap:anywhere}.server-problem{margin:.45rem 0 0;color:var(--text-muted);font-size:.8rem}.platforms{display:flex;flex-wrap:wrap;gap:.35rem .8rem;margin-top:.45rem;color:var(--text-muted);font-size:.76rem}.service-details{margin-top:.35rem;color:var(--text-muted);font-size:.8rem}.service-details summary{cursor:pointer;color:var(--accent-text)}.service-details p{margin:.4rem 0 0}</style>
