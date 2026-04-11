<script lang="ts">
  let { count, onrun }: {
    count: number;
    onrun: () => Promise<void>;
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
    <p>{count} item{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} to be migrated to the latest format.</p>
  </div>
  <div class="alert-actions">
    <button class="btn-migrate" onclick={handleMigrate} disabled={running}>
      {running ? 'Migrating...' : 'Migrate'}
    </button>
  </div>
</div>

<style>
  .migration-alert {
    background: var(--accent-subtler);
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

  .alert-content p {
    margin: 0.25rem 0 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .alert-actions {
    display: flex;
    gap: 0.5rem;
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

  .btn-migrate:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
