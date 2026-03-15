<script lang="ts">
  import type { PendingMigration } from '@inbox-rs/rs-module';

  let { migrations, onrun, ondismiss }: {
    migrations: PendingMigration[];
    onrun: () => void;
    ondismiss: () => void;
  } = $props();

  let running = $state(false);

  async function handleMigrate() {
    running = true;
    try {
      await onrun();
    } finally {
      running = false;
    }
  }
</script>

<div class="migration-alert" role="alert">
  <div class="alert-content">
    <strong>Data migration available</strong>
    <ul>
      {#each migrations as m}
        <li>{m.description} ({m.itemCount} item{m.itemCount === 1 ? '' : 's'})</li>
      {/each}
    </ul>
  </div>
  <div class="alert-actions">
    <button class="btn-dismiss" onclick={ondismiss} disabled={running}>Dismiss</button>
    <button class="btn-migrate" onclick={handleMigrate} disabled={running}>
      {running ? 'Migrating...' : 'Migrate'}
    </button>
  </div>
</div>

<style>
  .migration-alert {
    background: rgba(99, 102, 241, 0.1);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: 1rem;
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .alert-content {
    flex: 1;
    min-width: 200px;
  }

  .alert-content strong {
    font-size: 0.9rem;
  }

  .alert-content ul {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .alert-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn-dismiss {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .btn-dismiss:hover {
    border-color: var(--text-muted);
  }

  .btn-migrate {
    background: var(--accent);
    border: none;
    color: white;
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-migrate:hover {
    opacity: 0.9;
  }

  .btn-migrate:disabled,
  .btn-dismiss:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
