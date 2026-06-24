/** Marker pushed onto the history stack for each open overlay layer. */
export const OVERLAY_HISTORY_STATE_KEY = 'inboxRsOverlay';

export type OverlayKind =
  | 'capture-sheet'
  | 'view-card'
  | 'add-entry'
  | 'collection-form'
  | 'group-form';

export interface OverlayHistoryState {
  [OVERLAY_HISTORY_STATE_KEY]: true;
}

export function isOverlayHistoryState(
  state: unknown,
): state is OverlayHistoryState {
  return !!(
    state &&
    typeof state === 'object' &&
    (state as OverlayHistoryState)[OVERLAY_HISTORY_STATE_KEY] === true
  );
}

export function pushOverlayHistoryEntry(): void {
  window.history.pushState(
    { [OVERLAY_HISTORY_STATE_KEY]: true },
    '',
    window.location.href,
  );
}

export function navigateHistoryBack(): void {
  window.history.back();
}

export function navigateHistoryBy(delta: number): void {
  window.history.go(delta);
}

export interface OverlayStackHandlers {
  dismiss: (kind: OverlayKind) => void;
}

/** Tracks overlay layers against browser history entries (push on open, pop on back). */
export class OverlayStack {
  private readonly stack: OverlayKind[] = [];
  private suppressPopstate = false;

  constructor(private readonly handlers: OverlayStackHandlers) {}

  depth(): number {
    return this.stack.length;
  }

  /** Push a history entry for a newly opened overlay. */
  open(kind: OverlayKind): void {
    this.stack.push(kind);
    pushOverlayHistoryEntry();
  }

  /** User closed via UI — pop the matching history entry, which triggers dismiss. */
  requestClose(): void {
    if (this.stack.length === 0) return;
    navigateHistoryBack();
  }

  /** Browser back/forward while an overlay entry is active — dismiss without history.back(). */
  handlePopstate(): boolean {
    if (this.suppressPopstate) return false;
    const kind = this.stack.pop();
    if (!kind) return false;
    this.handlers.dismiss(kind);
    return true;
  }

  /**
   * Drop a layer that was closed programmatically (e.g. capture sheet → add modal).
   * Removes the history entry without running dismiss handlers.
   */
  drop(kind: OverlayKind): void {
    const idx = this.stack.lastIndexOf(kind);
    if (idx === -1) return;
    this.stack.splice(idx, 1);
    this.withSuppressedPopstate(() => navigateHistoryBack());
  }

  /** Route changed — discard overlay history without dismiss side effects. */
  abandonAll(): void {
    const count = this.stack.length;
    this.stack.length = 0;
    if (count > 0) {
      this.withSuppressedPopstate(() => navigateHistoryBy(-count));
    }
  }

  private withSuppressedPopstate(run: () => void): void {
    this.suppressPopstate = true;
    try {
      run();
    } finally {
      this.suppressPopstate = false;
    }
  }
}
