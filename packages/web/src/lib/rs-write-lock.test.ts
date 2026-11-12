/**
 * A write that lands while an earlier version of the same document is being
 * pushed must still reach the server (#329).
 *
 * Runs the real remotestoragejs caching layer and Sync against a fake
 * server, and sweeps the second write across every microtask offset around
 * the first push's response — the window where the library's bookkeeping
 * used to overwrite it.
 */

import RemoteStorage from 'remotestoragejs';
import { describe, expect, it } from 'vitest';
import { serializeCacheWrites } from './rs-write-lock';

const PATH = '/inbox/items/a';

type PutOptions = { ifMatch?: string; ifNoneMatch?: string };

/** The parts of remotestoragejs this test reaches into. */
type Internals = {
  featureModules: { Sync: new (rs: unknown) => { sync(): Promise<void> } };
  local: {
    put(path: string, body: string, contentType: string): Promise<unknown>;
  };
  remote: Record<string, unknown>;
};

async function loadedStorage(): Promise<RemoteStorage & Internals> {
  const rs = new RemoteStorage({
    changeEvents: { local: false, window: false, remote: false },
  }) as RemoteStorage & Internals;
  rs.access.claim('inbox', 'rw');
  rs.caching.enable('/inbox/');
  await new Promise<void>((resolve) => rs.on('features-loaded', resolve));
  return rs;
}

/**
 * A remoteStorage server holding one document. PUTs honour If-Match the way
 * a real server does, and every response is held until `release()` so the
 * test decides exactly when a push completes.
 */
function fakeServer() {
  let body: string | undefined;
  let revision = 0;
  const held: Array<() => void> = [];
  const hold = <T>(response: T) =>
    new Promise<T>((resolve) => held.push(() => resolve(response)));

  return {
    get body() {
      return body;
    },
    get pending() {
      return held.length;
    },
    release() {
      held.shift()?.();
    },
    remote: {
      connected: true,
      online: true,
      put(_path: string, next: string, _type: string, options: PutOptions) {
        const current = revision ? `rev-${revision}` : undefined;
        const stale =
          (options.ifMatch !== undefined && options.ifMatch !== current) ||
          (options.ifNoneMatch === '*' && current !== undefined);
        if (stale) return hold({ statusCode: 412, revision: current });
        body = next;
        revision += 1;
        return hold({ statusCode: 200, revision: `rev-${revision}` });
      },
      get(path: string) {
        if (path === PATH && revision) {
          return hold({
            statusCode: 200,
            body,
            contentType: 'text/plain',
            revision: `rev-${revision}`,
          });
        }
        return hold({ statusCode: 404 });
      },
      delete: () => hold({ statusCode: 200 }),
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Let sync run to a standstill, answering every request it makes. */
async function settle(server: ReturnType<typeof fakeServer>) {
  let idle = 0;
  while (idle < 5) {
    if (server.pending) {
      server.release();
      idle = 0;
    } else {
      idle += 1;
    }
    // Sync waits 10 ms between rounds of tasks.
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

async function secondWriteAt(offset: number): Promise<string | undefined> {
  const rs = await loadedStorage();
  const server = fakeServer();
  Object.assign(rs.remote, server.remote);
  // Constructing Sync subscribes it to local writes, as on `ready`.
  new rs.featureModules.Sync(rs);

  await rs.local.put(PATH, 'first', 'text/plain');
  while (!server.pending) await tick();

  // The server answers the first PUT; the second write lands `offset`
  // microtasks into the library's handling of that answer.
  server.release();
  for (let i = 0; i < offset; i++) await Promise.resolve();
  await rs.local.put(PATH, 'second', 'text/plain');

  await settle(server);
  return server.body;
}

describe('serializeCacheWrites', () => {
  it('pushes a write that lands while the same document is mid-push', async () => {
    serializeCacheWrites(await loadedStorage());

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, offset) => secondWriteAt(offset)),
    );

    expect(results).toEqual(results.map(() => 'second'));
  });
});
