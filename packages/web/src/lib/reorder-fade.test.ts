// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fadeMock, tickMock } = vi.hoisted(() => ({
  fadeMock: vi.fn((_node: Element, params?: { duration?: number }) => ({
    duration: params?.duration ?? 0,
  })),
  tickMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('svelte/transition', () => ({
  fade: fadeMock,
}));

vi.mock('svelte', () => ({
  tick: tickMock,
}));

import { createReorderFade } from './reorder-fade';

describe('createReorderFade', () => {
  const node = document.createElement('div');

  beforeEach(() => {
    fadeMock.mockClear();
    tickMock.mockClear();
  });

  it('passes fade params through when not reordering', () => {
    const { fade } = createReorderFade();
    fade(node, { duration: 180 });
    expect(fadeMock).toHaveBeenCalledWith(node, { duration: 180 });
  });

  it('forces zero duration while a reorder is in flight', () => {
    const { fade, start } = createReorderFade();
    start();
    fade(node, { duration: 180 });
    expect(fadeMock).toHaveBeenCalledWith(node, { duration: 0 });
  });

  it('restores fade params after end() flushes the drop re-key', async () => {
    const { fade, start, end } = createReorderFade();
    start();
    await end();
    fade(node, { duration: 120 });
    expect(tickMock).toHaveBeenCalledOnce();
    expect(fadeMock).toHaveBeenLastCalledWith(node, { duration: 120 });
  });
});
