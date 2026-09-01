<script lang="ts">
  import { tick } from 'svelte';
  import { alertPermission } from '../lib/alerts';
  import { trapFocus } from '../lib/actions';
  import { calendarAccounts } from '../lib/calendar-accounts';
  import { needsEnrichment } from '../lib/enrich';
  import { layout } from '../lib/layout';
  import { buildDate, versionLabel } from '../lib/build-info';
  import { SETTINGS_SECTIONS, type SectionId, type SettingsSection } from '../lib/settings-sections';
  import { connected, items, syncing, userAddress, userSettings } from '../lib/stores';
  import { ACCENT_LABELS, isAccent } from '../lib/theme';
  import AboutSettings from './settings/AboutSettings.svelte';
  import AccountSettings from './settings/AccountSettings.svelte';
  import AppearanceSettings from './settings/AppearanceSettings.svelte';
  import AppsSettings from './settings/AppsSettings.svelte';
  import CalendarSettings from './settings/CalendarSettings.svelte';
  import DataSettings from './settings/DataSettings.svelte';
  import LinkSettings from './settings/LinkSettings.svelte';
  import NotificationsSettings from './settings/NotificationsSettings.svelte';
  import SettingsIcon from './settings/SettingsIcon.svelte';
  import SettingsTile from './settings/SettingsTile.svelte';
  import './settings/settings.css';

  let { open: isOpen = $bindable(false), initialSection }: { open: boolean; initialSection?: SectionId } = $props();
  let expanded = $state<SectionId | null>(null);
  let mobile = $state(false);
  let panelEl = $state<HTMLElement | null>(null);
  let backButton = $state<HTMLButtonElement | null>(null);
  let homeScroll = 0;

  const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
  const itemList = $derived(Object.values($items));
  const missingPreviews = $derived(itemList.filter((item) => item.type === 'bookmark' && needsEnrichment(item)).length);
  const theme = $derived($userSettings.theme ?? read('inbox-rs:theme') ?? 'system');
  const accentRaw = $derived(read('inbox-rs:accent'));
  const accent = $derived(isAccent(accentRaw) ? ACCENT_LABELS[accentRaw] : 'Indigo');
  const selected = $derived(SETTINGS_SECTIONS.find((s) => s.id === expanded));

  function value(section: SettingsSection): string {
    switch (section.id) {
      case 'appearance': return `${theme === 'system' ? 'System' : theme[0].toUpperCase() + theme.slice(1)} · ${accent}`;
      case 'links': return $userSettings.linkPreviews === false ? 'Off' : 'On';
      case 'calendars': return `${$calendarAccounts.length} account${$calendarAccounts.length === 1 ? '' : 's'}`;
      case 'notifications': return $alertPermission === 'granted' ? 'Allowed' : 'Not allowed';
      case 'data': return `${itemList.length} items`;
      case 'apps': return 'Capture tools';
      case 'account': return $connected ? 'Synced' : 'Not connected';
      case 'about': return versionLabel;
    }
  }
  function sub(section: SettingsSection): string {
    switch (section.id) {
      case 'appearance': return $layout === 'classic' ? 'Top-tab navigation' : 'Sidebar navigation';
      case 'links': return `${missingPreviews} links still to fetch`;
      case 'calendars': return $calendarAccounts.length ? `${$calendarAccounts.reduce((n,a)=>n+a.calendars.length,0)} calendars` : 'Add a calendar account';
      case 'notifications': return 'Alerts when a todo is due';
      case 'data': return 'Export or restore a backup';
      case 'apps': return 'Apps and add-ons';
      case 'account': return $userAddress || 'Connect remoteStorage';
      case 'about': return `What's new · Source · Deployed ${buildDate}`;
    }
  }
  function stateLine(section: SettingsSection) { return `${value(section)} · ${sub(section)}`; }

  $effect(() => {
    if (!isOpen) { expanded = null; return; }
    expanded = initialSection ?? null;
  });
  $effect(() => {
    const mq = matchMedia('(max-width: 767px)'); mobile = mq.matches;
    const change = (e: MediaQueryListEvent) => mobile = e.matches;
    mq.addEventListener('change', change); return () => mq.removeEventListener('change', change);
  });

  async function choose(id: SectionId) {
    if (mobile) homeScroll = panelEl?.scrollTop ?? 0;
    expanded = id;
    await tick();
    if (mobile) backButton?.focus(); else document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'nearest' });
  }
  async function back() { expanded = null; await tick(); if (panelEl) panelEl.scrollTop = homeScroll; }
  function keydown(e: KeyboardEvent) { if (e.key !== 'Escape') return; if (expanded) { e.stopPropagation(); void back(); } else isOpen = false; }
</script>

<svelte:window onkeydown={keydown}/>
{#if isOpen}
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="settings-overlay" onclick={() => isOpen = false}>
  <section class="settings-modal" bind:this={panelEl} use:trapFocus role="dialog" aria-modal="true" aria-label="Settings" onclick={(e)=>e.stopPropagation()}>
    <header class="modal-head" aria-live="polite">
      {#if mobile && selected}
        <button bind:this={backButton} class="back" type="button" onclick={back}>‹ Settings</button><h2>{selected.title}</h2>
      {:else}<h2>Settings</h2><button class="done" type="button" onclick={()=>isOpen=false}>{mobile?'Done':'✕'}</button>{/if}
    </header>
    {#if mobile && selected}<div class="mobile-state">{stateLine(selected)}</div>{/if}
    {#if !mobile || !selected}
      {#if mobile}<div class="identity"><span class="identity-avatar">{$connected ? ($userSettings.abbreviation || $userAddress.slice(0,2).toUpperCase()) : '?'}</span><span><strong>{$userAddress || 'Not connected'}</strong><small>{$syncing?'Syncing…':$connected?'Synced':'Connect your storage'}</small></span></div>{/if}
      <div class="tiles">
      {#each SETTINGS_SECTIONS as section (section.id)}
        <SettingsTile {section} value={value(section)} sub={sub(section)} expanded={expanded===section.id} onclick={()=>void choose(section.id)}/>
        {#if !mobile && expanded === section.id}<div class="expanded" id={`settings-${section.id}`}>{@render Section(section)}</div>{/if}
      {/each}
      </div>
    {:else}<div class="mobile-detail">{@render Section(selected)}</div>{/if}
  </section>
</div>
{/if}

{#snippet Section(section: SettingsSection)}
  <div class="section-head"><span class="sec-icon"><SettingsIcon name={section.icon}/></span><div><h3>{section.title}</h3><p>{stateLine(section)}</p></div>{#if !mobile}<button type="button" aria-label={`Collapse ${section.title}`} onclick={back}>✕</button>{/if}</div>
  {#if section.id==='appearance'}<AppearanceSettings/>{:else if section.id==='links'}<LinkSettings/>{:else if section.id==='calendars'}<CalendarSettings/>{:else if section.id==='notifications'}<NotificationsSettings/>{:else if section.id==='data'}<DataSettings/>{:else if section.id==='apps'}<AppsSettings/>{:else if section.id==='account'}<AccountSettings focusConnect={initialSection==='account'}/>{:else}<AboutSettings/>{/if}
{/snippet}

<style>
  .settings-overlay{position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;padding:1rem;background:var(--overlay)}.settings-modal{width:min(940px,100%);max-height:88vh;overflow:auto;overscroll-behavior:contain;border:1px solid var(--border);border-radius:16px;background:var(--surface);box-shadow:0 24px 70px -12px var(--shadow)}.modal-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:.75rem;padding:1rem 1.15rem;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--surface) 94%,transparent);backdrop-filter:blur(12px)}.modal-head h2{margin:0;font-size:1.05rem}.done{margin-left:auto;border:0;background:none;color:var(--text-muted);font-size:1rem;cursor:pointer}.back{border:0;background:none;color:var(--accent);font-size:1rem;padding:.5rem}.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;padding:1.15rem}.tile{min-width:0;text-align:left;padding:.95rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);color:var(--text);display:grid;gap:.5rem;cursor:pointer}.tile:hover{border-color:var(--accent);transform:translateY(-2px)}.tile.wide{grid-column:span 2}.tile .top{display:flex;align-items:center;gap:.55rem}.tile .name{font-size:.9rem;font-weight:600}.tile .body strong,.tile .body small,.tile .appearance-body strong,.tile .appearance-body small{display:block}.tile .body strong,.tile .appearance-body strong{font-size:1.02rem}.tile small{margin-top:.12rem;color:var(--text-muted);font-size:.78rem}.tile .appearance-body{display:flex;align-items:center;gap:.85rem}.tile-mini{display:grid;grid-template-columns:1fr 1fr;gap:3px;width:74px;height:46px;padding:13px 5px 5px;border:1.5px solid var(--accent);border-radius:7px}.tile-mini>*{background:var(--accent-subtler);border-radius:2px}.mini-swatches{display:flex;gap:4px;margin-top:5px}.mini-swatches i{width:10px;height:10px;border-radius:50%;background:var(--accent)}.mini-swatches i:nth-child(2){background:#7c3aed}.mini-swatches i:nth-child(3){background:#2563eb}.mini-swatches i:nth-child(4){background:#0e7490}.mini-swatches i:nth-child(5){background:#2f8079}.mini-swatches i:nth-child(6){background:#c2410c}.mini-swatches i:nth-child(7){background:#be123c}.sec-icon{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none;background:var(--accent-subtler);color:var(--accent)}.sec-icon :global(svg){width:15px;height:15px}.expanded{grid-column:1/-1;padding:1.15rem;border:1px solid var(--accent);border-radius:var(--radius);box-shadow:0 0 0 3px var(--accent-subtler);scroll-margin-top:1rem}.section-head{display:flex;align-items:center;gap:.65rem;margin-bottom:.7rem}.section-head h3,.section-head p{margin:0}.section-head h3{font-size:.94rem}.section-head p{margin-top:.1rem;font-size:.79rem;color:var(--text-muted)}.section-head button{margin-left:auto;border:0;background:none;color:var(--text-muted);cursor:pointer}.identity{display:none}.mobile-state{padding:.55rem 1rem;border-bottom:1px solid var(--border);font-size:.79rem;color:var(--text-muted)}.mobile-detail{padding:1rem}
  @media(max-width:767px){.settings-overlay{padding:0}.settings-modal{width:100%;height:100%;max-height:none;border:0;border-radius:0}.modal-head{min-height:58px}.modal-head h2{flex:1;text-align:center}.identity{display:flex;align-items:center;gap:.7rem;margin:.9rem 1rem 0;padding:.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)}.identity-avatar{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:var(--accent-subtle);color:var(--accent);font-weight:700}.identity strong,.identity small{display:block}.identity small{color:var(--text-muted);font-size:.78rem}.tiles{grid-template-columns:1fr 1fr;padding:1rem}.tile.wide{grid-column:1/-1}.tile{min-height:122px}.section-head{display:none}.mobile-detail{min-height:calc(100vh - 100px)}}
</style>
