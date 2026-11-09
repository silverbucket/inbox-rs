// @vitest-environment jsdom

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeleteConfirm from './DeleteConfirm.svelte';

describe('DeleteConfirm', () => {
  let component: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (component) unmount(component);
    document.body.innerHTML = '';
  });

  it('says a read-only entry stays in its calendar and may come back', () => {
    component = mount(DeleteConfirm, {
      target: document.body,
      props: {
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        keptIn: 'Work',
        mayReturn: true,
      },
    });
    flushSync();
    expect(document.body.querySelector('input[type="checkbox"]')).toBeNull();
    expect(document.body.textContent).toContain(
      'It stays in the Work calendar',
    );
    expect(document.body.textContent).toContain(
      'comes back here if it changes there',
    );
  });
});
