<script lang="ts">
  import rs from '../lib/rs';
  import { authorizationRequired } from '../lib/stores';

  let reconnectError = $state('');
  /** Start remoteStorage's OAuth reconnect flow and report startup failures. */
  function reconnect() {
    reconnectError = '';
    try {
      rs.reconnect();
    } catch {
      reconnectError = 'Could not start reconnection. Please try again.';
    }
  }
</script>

{#if $authorizationRequired}
  <div class="authorization-notice" role="alert">
    <div>
      <strong>Reconnect your storage</strong>
      <p>Inbox’s access to your remoteStorage has expired or been revoked. Changes are saved in this browser but cannot sync until you reconnect.</p>
      {#if reconnectError}<p>{reconnectError}</p>{/if}
    </div>
    <button type="button" onclick={reconnect}>Reconnect</button>
  </div>
{/if}

<style>
  .authorization-notice { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; margin: 1rem; padding: 1rem; border: 1px solid var(--danger, #dc2626); border-radius: var(--radius-sm, 8px); background: var(--surface); color: var(--text); }
  .authorization-notice > div { flex: 1 1 15rem; }
  p { margin: .35rem 0 0; }
  button { padding: .5rem 1rem; border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); background: var(--accent); color: var(--accent-text, white); cursor: pointer; }
</style>
