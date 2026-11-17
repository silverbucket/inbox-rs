/**
 * Settings on desktop: an open section scrolls cleanly under the modal's
 * title bar, has one close control (the modal's), and a long section ends
 * on a fade rather than a hard edge.
 */

import { expect, test } from '../helpers/fixtures';

test('an open Settings section stays clear of the title bar and fades at the bottom', async ({
  connectedPage: page,
  webOrigin,
}) => {
  // A laptop-height window, where an open section runs past the modal.
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('ControlOrMeta+,');
  const modal = page.getByRole('dialog', { name: 'Settings' });
  await expect(modal).toBeVisible();

  const tile = modal.getByRole('button', { name: /^Boards — / });
  await tile.click();
  await expect(tile).toHaveAttribute('aria-expanded', 'true');
  const section = page.locator('#settings-columns');
  await expect(section).toBeVisible();
  const head = modal.locator('.modal-head');
  const sectionHead = section.locator('.section-head');

  // Opening the section lands its header fully below the title bar: the
  // icon is what a click on it hits, not the bar. Measured and hit-tested
  // in one step, retried until the slide and reveal scroll settle.
  await expect
    .poll(() =>
      sectionHead.locator('.sec-icon').evaluate((icon) => {
        const bar = icon
          .closest('[role="dialog"]')
          ?.querySelector('.modal-head')
          ?.getBoundingClientRect();
        const box = icon.getBoundingClientRect();
        if (!bar || box.top < bar.bottom) return false;
        const at = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return !!at && (icon === at || icon.contains(at));
      }),
    )
    .toBe(true);

  // Content scrolls under the bar without showing through it.
  const background = await head.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  // rgba(r, g, b, a), or color(srgb r g b / a) from color-mix().
  const alpha =
    background.match(/\/\s*([\d.]+)\)$/)?.[1] ??
    background.match(/^rgba\([^)]*,\s*([\d.]+)\)$/)?.[1];
  expect(alpha === undefined || Number(alpha) === 1, background).toBe(true);

  // One close control: the modal's. The open tile collapses its section.
  await expect(section.getByRole('button', { name: /^Collapse / })).toHaveCount(
    0,
  );

  // The scroll area ends on a fade while there is more below.
  const scroller = modal;
  const overflows = await scroller.evaluate(
    (el) => el.scrollHeight > el.clientHeight + 40,
  );
  expect(overflows, 'Settings with Boards open overflows the modal').toBe(true);
  const fade = modal.locator('.scroll-fade');
  const [fadeBox, modalBox] = await Promise.all([
    fade.boundingBox(),
    modal.boundingBox(),
  ]);
  if (!fadeBox || !modalBox) throw new Error('fade not laid out');
  expect(
    Math.abs(fadeBox.y + fadeBox.height - (modalBox.y + modalBox.height)),
  ).toBeLessThanOrEqual(2);
  expect(await fade.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe(
    'none',
  );

  // Scrolled so the section header sits under the bar, the bar is what a
  // click there hits.
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const bar = await head.boundingBox();
  if (!bar) throw new Error('title bar not laid out');
  expect(
    await head.evaluate(
      (el, [x, y]) => {
        const at = document.elementFromPoint(x, y);
        return !!at && (el === at || el.contains(at));
      },
      [bar.x + bar.width / 2, bar.y + bar.height - 2],
    ),
  ).toBe(true);

  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  await expect(tile).toHaveAttribute('aria-expanded', 'false');
  await expect(section).toHaveCount(0);
});
