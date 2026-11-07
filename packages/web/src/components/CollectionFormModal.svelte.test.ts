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

import { groups, sortedGroups } from '../lib/stores';
import CollectionFormModal from './CollectionFormModal.svelte';

function fill(selector: string, value: string) {
  const el = document.querySelector(selector) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
const submit = () =>
  document.querySelector('button[type="submit"]') as HTMLButtonElement;
const cancel = () =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Cancel',
  ) as HTMLButtonElement;

describe('CollectionFormModal', () => {
  let component: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    groups.set({});
    sortedGroups.set([]);
    if (component) unmount(component);
    component = undefined;
    document.body.innerHTML = '';
  });

  it('explains what a group is when asking for a new one', () => {
    component = mount(CollectionFormModal, {
      target: document.body,
      props: { onclose: vi.fn(), onsave: vi.fn() },
    });
    flushSync();

    const input = document.querySelector('input[aria-label="New group name"]');
    const hint = document.getElementById(
      input?.getAttribute('aria-describedby') ?? '',
    );
    expect(hint?.textContent).toContain('Groups hold related collections');
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

    fill('input[placeholder="e.g. Reading List"]', 'Reading list');
    fill('input[aria-label="New group name"]', 'Reading');
    submit().click();
    flushSync();

    cancel().click();
    expect(onclose).not.toHaveBeenCalled();

    finishGroup();
    await vi.waitFor(() => expect(onsave).toHaveBeenCalledTimes(1));
    const saved = onsave.mock.calls[0][0];
    expect(saved).toMatchObject({ name: 'Reading list' });
    // The new group was written already listing the collection it was made for.
    const [group] = storeGroup.mock.calls[0];
    expect(group.collectionIds).toEqual([saved.id]);
    expect(saved.groupId).toBe(group.id);
  });

  it('stays open until the collection is stored, and shows a failure to retry', async () => {
    // Like the real store: the stored group becomes pickable.
    storeGroup.mockImplementation(async (g) => {
      groups.set({ [g.id]: g });
      sortedGroups.set([g]);
    });
    let failSave = (_e: Error) => {};
    const onclose = vi.fn();
    const onsave = vi.fn(
      () => new Promise<void>((_resolve, reject) => (failSave = reject)),
    );
    component = mount(CollectionFormModal, {
      target: document.body,
      props: { onclose, onsave },
    });
    flushSync();
    fill('input[placeholder="e.g. Reading List"]', 'Reading list');
    fill('input[aria-label="New group name"]', 'Reading');
    submit().click();
    await vi.waitFor(() => expect(onsave).toHaveBeenCalledTimes(1));

    // The collection write is still pending: no closing, no second submit.
    cancel().click();
    expect(onclose).not.toHaveBeenCalled();
    expect(submit().disabled).toBe(true);

    failSave(new Error('Store failed: 503'));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Store failed: 503'),
    );
    expect(submit().disabled).toBe(false);
    cancel().click();
    expect(onclose).toHaveBeenCalledTimes(1);
  });
});
