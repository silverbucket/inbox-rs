<script lang="ts">
  import type { Page, Route } from '../lib/route';
  import SidebarShell from '../components/SidebarShell.svelte';

  let {
    route,
    navTo,
    navToCollection,
    viewTodoCount,
    totalTodoCount,
    onaddgroup,
  }: {
    route: Route;
    navTo: (page: Page) => void;
    navToCollection: (id: string) => void;
    viewTodoCount: number;
    totalTodoCount: number;
    onaddgroup: () => void;
  } = $props();
</script>

<SidebarShell {route} {navTo} {navToCollection} {viewTodoCount} {totalTodoCount} {onaddgroup}>
  {#snippet children()}
    <div data-testid="shell-body"></div>
  {/snippet}
</SidebarShell>
