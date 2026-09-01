<script lang="ts">
  import type { SettingsSection } from '../../lib/settings-sections';
  import SettingsIcon from './SettingsIcon.svelte';
  let { section, value, sub, warning = false, expanded = false, onclick }: {
    section: SettingsSection; value: string; sub: string; warning?: boolean; expanded?: boolean; onclick: () => void;
  } = $props();
</script>
<button type="button" class="tile" class:wide={section.wide} class:warn={warning}
  aria-label={`${section.title} — ${value}${sub ? `, ${sub}` : ''}`}
  aria-expanded={expanded} aria-controls={expanded ? `settings-${section.id}` : undefined} {onclick}>
  <span class="top"><span class="sec-icon"><SettingsIcon name={section.icon}/></span><span class="name">{section.title}</span></span>
  {#if section.id === 'appearance'}
    <span class="appearance-body"><span class="tile-mini"><i></i><i></i><i></i><b></b><b></b></span><span><strong>{value}</strong><small>{sub}</small><span class="mini-swatches"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></span></span>
  {:else}<span class="body"><strong>{value}</strong><small>{sub}</small></span>{/if}
</button>
<style>
  .tile{min-width:0;text-align:left;padding:.95rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);color:var(--text);display:grid;gap:.5rem;cursor:pointer}.tile:hover{border-color:var(--accent);transform:translateY(-2px)}.tile.wide{grid-column:span 2}.top{display:flex;align-items:center;gap:.55rem}.name{font-size:.9rem;font-weight:600}.body strong,.body small,.appearance-body strong,.appearance-body small{display:block}.body strong,.appearance-body strong{font-size:1.02rem}.tile small{margin-top:.12rem;color:var(--text-muted);font-size:.78rem}.appearance-body{display:flex;align-items:center;gap:.85rem}.sec-icon{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none;background:var(--accent-subtler);color:var(--accent)}.sec-icon :global(svg){width:15px;height:15px}.tile-mini{display:grid;grid-template-columns:1fr 1fr;gap:3px;width:74px;height:46px;padding:13px 5px 5px;border:1.5px solid var(--accent);border-radius:7px}.tile-mini>*{background:var(--accent-subtler);border-radius:2px}.mini-swatches{display:flex;gap:4px;margin-top:5px}.mini-swatches i{width:10px;height:10px;border-radius:50%;background:var(--accent)}.mini-swatches i:nth-child(2){background:#7c3aed}.mini-swatches i:nth-child(3){background:#2563eb}.mini-swatches i:nth-child(4){background:#0e7490}.mini-swatches i:nth-child(5){background:#2f8079}.mini-swatches i:nth-child(6){background:#c2410c}.mini-swatches i:nth-child(7){background:#be123c}@media(max-width:767px){.tile{min-height:122px}.tile.wide{grid-column:1/-1}}
</style>
