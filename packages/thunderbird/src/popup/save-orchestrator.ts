/**
 * Save-flow orchestrator for the Thunderbird popup.
 *
 * Mirrors `packages/extension/src/popup/save-orchestrator.ts` — the popup
 * historically called `rs.store()` directly with no error handling, so any
 * rejection (expired token, network failure, missing host_permissions
 * blocking the PUT) left the UI stuck in "Saving…" forever. This wrapper
 * turns errors into tagged results so the popup can reset its spinner in
 * `finally` and surface a real message instead of hanging.
 */
import type { DirectRS, EmailItem } from '@inbox-rs/rs-module';

/** Tagged outcome for a save attempt. Errors never throw — they become `{ ok: false }`. */
export type SaveResult = { ok: true } | { ok: false; error: string };

export interface SaveEmailOrchestratorParams {
  rs: DirectRS;
  subject: string;
  author: string;
  bodyText: string;
  notes: string;
  messageUrl: string;
  /** Override for tests; defaults to `crypto.randomUUID()`. */
  generateId?: () => string;
  /** Override for tests; defaults to `new Date().toISOString()`. */
  now?: () => string;
}

/**
 * Save the currently-displayed email as an `EmailItem`. Always resolves —
 * any error from `rs.store` is converted to `{ ok: false, error }`.
 */
export async function runSaveEmail(params: SaveEmailOrchestratorParams): Promise<SaveResult> {
  const id = params.generateId?.() ?? crypto.randomUUID();
  const createdAt = params.now?.() ?? new Date().toISOString();

  const item: EmailItem = {
    id,
    type: 'email',
    title: params.subject || 'Untitled email',
    body: params.bodyText,
    from: params.author || undefined,
    notes: params.notes.trim() || undefined,
    messageUrl: params.messageUrl || undefined,
    createdAt,
  };

  try {
    await params.rs.store(item);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: errorMessage(e) };
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return 'Save failed';
}
