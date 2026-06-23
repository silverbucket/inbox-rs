// @vitest-environment jsdom
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, showToast, toast } from './toast';

afterEach(() => {
  dismissToast();
  vi.useRealTimers();
});

describe('toast store', () => {
  it('shows a message and clears on dismiss', () => {
    showToast('Saved note');
    expect(get(toast)?.message).toBe('Saved note');
    dismissToast();
    expect(get(toast)).toBeNull();
  });

  it('carries an action that the caller can run', () => {
    const run = vi.fn();
    showToast('Saved note', { label: 'Undo', run });
    get(toast)?.action?.run();
    expect(run).toHaveBeenCalledOnce();
  });

  it('auto-dismisses after the timeout', () => {
    vi.useFakeTimers();
    showToast('Saved note');
    expect(get(toast)).not.toBeNull();
    vi.advanceTimersByTime(5000);
    expect(get(toast)).toBeNull();
  });
});
