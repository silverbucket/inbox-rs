// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { writable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { storeGroup, updateConfig } = vi.hoisted(() => ({
  storeGroup: vi.fn(),
  updateConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/stores', () => ({
  appConfig: writable({}),
  groups: writable({}),
  sortedGroups: writable([]),
  storeGroup,
  updateConfig,
}));

import CollectionFormModal from './CollectionFormModal.svelte';

describe('CollectionFormModal', () => {
  let component: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    document.body.innerHTML = '';
  });

  it('ignores Cancel while the new group is still being written', async () => {
    let finishGroup = () => {};
    storeGroup.mockReturnValue(new Promise<void>((r) => (finishGroup = r)));
    const onclose = vi.fn();
    const onsave = vi.fn();
    component = mount(CollectionFormModal, {
      target: document.body,
      props: { onclose, onsave },
    });
    flushSync();

    const fill = (el: HTMLInputElement, value: string) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    fill(
      document.querySelector(
        'input[placeholder="e.g. Reading List"]',
      ) as HTMLInputElement,
      'Reading list',
    );
    fill(
      document.querySelector(
        'input[aria-label="New group name"]',
      ) as HTMLInputElement,
      'Reading',
    );
    flushSync();
    (
      document.querySelector('button[type="submit"]') as HTMLButtonElement
    ).click();
    flushSync();

    const cancel = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Cancel',
    );
    cancel?.click();
    expect(onclose).not.toHaveBeenCalled();

    finishGroup();
    await vi.waitFor(() => expect(onsave).toHaveBeenCalledTimes(1));
    expect(onsave.mock.calls[0][0]).toMatchObject({ name: 'Reading list' });
  });
});
