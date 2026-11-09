<script lang="ts">
  import type { Collection } from '@inbox-rs/rs-module';
  import type { Component } from 'svelte';
  import { loadLazy } from '../lib/lazy-load';

  /**
   * LinkCalendarSheet, loaded on first use. Linking needs the network (it
   * previews the calendar through the relay), so the sheet stays out of
   * the main bundle and the offline precache.
   */
  type Props = {
    collection?: Collection;
    calendarId?: string;
    onclose: () => void;
  };
  let props: Props = $props();

  let Sheet = $state<Component<Props> | null>(null);
  void loadLazy<Component<Props>>(
    () => import('./LinkCalendarSheet.svelte'),
    () => props.onclose(),
  ).then((loaded) => {
    Sheet = loaded;
  });
</script>

{#if Sheet}
  <Sheet {...props} />
{/if}
