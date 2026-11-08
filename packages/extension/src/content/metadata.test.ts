// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.reddit.com/r/therightbook/comments/1xlli1q/lesson_7_is_must/"}
import { beforeAll, describe, expect, it, vi } from 'vitest';

type Listener = (
  msg: unknown,
  sender: unknown,
  sendResponse: (value: unknown) => void,
) => unknown;
let listener: Listener;

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener: (fn: Listener) => (listener = fn) },
    },
  });
  await import('./metadata');
});

function getMetadata(): { ogImage?: string } {
  let result: unknown;
  listener({ type: 'get-metadata' }, {}, (value) => (result = value));
  return result as { ogImage?: string };
}

describe('content metadata on reddit.com', () => {
  it("prefers the post's image over the og:image share card", () => {
    document.head.innerHTML =
      '<meta property="og:image" content="https://share.redd.it/preview/post/1xlli1q">';
    document.body.innerHTML =
      '<shreddit-post post-type="image" content-href="https://i.redd.it/g6oz7p3e14zh1.jpeg"></shreddit-post>';
    expect(getMetadata().ogImage).toBe('https://i.redd.it/g6oz7p3e14zh1.jpeg');
  });

  it('falls back to og:image on a text post', () => {
    document.head.innerHTML =
      '<meta property="og:image" content="https://share.redd.it/preview/post/1xnp397">';
    document.body.innerHTML =
      '<shreddit-post post-type="text"></shreddit-post>';
    expect(getMetadata().ogImage).toBe(
      'https://share.redd.it/preview/post/1xnp397',
    );
  });
});
