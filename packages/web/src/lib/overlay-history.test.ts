import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isOverlayHistoryState,
  navigateHistoryBack,
  navigateHistoryBy,
  OVERLAY_HISTORY_STATE_KEY,
  type OverlayKind,
  OverlayStack,
  pushOverlayHistoryEntry,
} from './overlay-history';

function mockHistory() {
  const pushState = vi.fn();
  const back = vi.fn();
  const go = vi.fn();
  vi.stubGlobal('window', {
    location: { href: 'https://example.com/#/todos' },
    history: { pushState, back, go, state: null },
  });
  return { pushState, back, go };
}

describe('isOverlayHistoryState', () => {
  it('recognises overlay marker state', () => {
    expect(isOverlayHistoryState({ [OVERLAY_HISTORY_STATE_KEY]: true })).toBe(
      true,
    );
  });

  it('rejects null, primitives, and unrelated objects', () => {
    expect(isOverlayHistoryState(null)).toBe(false);
    expect(isOverlayHistoryState(undefined)).toBe(false);
    expect(isOverlayHistoryState('x')).toBe(false);
    expect(isOverlayHistoryState({ other: true })).toBe(false);
  });
});

describe('pushOverlayHistoryEntry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pushes a marked state at the current URL', () => {
    const { pushState } = mockHistory();
    pushOverlayHistoryEntry();
    expect(pushState).toHaveBeenCalledWith(
      { [OVERLAY_HISTORY_STATE_KEY]: true },
      '',
      'https://example.com/#/todos',
    );
  });
});

describe('OverlayStack', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createStack(onDismiss = vi.fn<(kind: OverlayKind) => void>()) {
    const history = mockHistory();
    const stack = new OverlayStack({ dismiss: onDismiss });
    return { stack, history, onDismiss };
  }

  it('open() pushes stack and history', () => {
    const { stack, history } = createStack();
    stack.open('view-card');
    expect(stack.depth()).toBe(1);
    expect(history.pushState).toHaveBeenCalledOnce();
  });

  it('requestClose() navigates back when a layer is open', () => {
    const { stack, history } = createStack();
    stack.open('add-entry');
    stack.requestClose();
    expect(history.back).toHaveBeenCalledOnce();
  });

  it('handlePopstate() dismisses the topmost layer', () => {
    const onDismiss = vi.fn<(kind: OverlayKind) => void>();
    const { stack } = createStack(onDismiss);
    stack.open('view-card');
    stack.open('add-entry');
    expect(stack.handlePopstate()).toBe(true);
    expect(onDismiss).toHaveBeenCalledWith('add-entry');
    expect(stack.depth()).toBe(1);
  });

  it('handlePopstate() returns false when the stack is empty', () => {
    const { stack } = createStack();
    expect(stack.handlePopstate()).toBe(false);
  });

  it('drop() removes a layer and syncs history without dismiss', () => {
    const onDismiss = vi.fn<(kind: OverlayKind) => void>();
    const { stack, history } = createStack(onDismiss);
    stack.open('capture-sheet');
    stack.open('add-entry');
    stack.drop('capture-sheet');
    expect(onDismiss).not.toHaveBeenCalled();
    expect(stack.depth()).toBe(1);
    expect(history.back).toHaveBeenCalledOnce();
  });

  it('abandonAll() clears the stack and rewinds history', () => {
    const onDismiss = vi.fn<(kind: OverlayKind) => void>();
    const { stack, history } = createStack(onDismiss);
    stack.open('view-card');
    stack.open('add-entry');
    stack.abandonAll();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(stack.depth()).toBe(0);
    expect(history.go).toHaveBeenCalledWith(-2);
  });

  it('suppresses dismiss while dropping history programmatically', () => {
    const onDismiss = vi.fn<(kind: OverlayKind) => void>();
    const { stack } = createStack(onDismiss);
    stack.open('view-card');
    stack.drop('view-card');
    expect(stack.handlePopstate()).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('navigateHistoryBack', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls history.back()', () => {
    const { back } = mockHistory();
    navigateHistoryBack();
    expect(back).toHaveBeenCalledOnce();
  });
});

describe('navigateHistoryBy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls history.go(delta)', () => {
    const { go } = mockHistory();
    navigateHistoryBy(-3);
    expect(go).toHaveBeenCalledWith(-3);
  });
});
