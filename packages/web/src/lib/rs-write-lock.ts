import type RemoteStorage from 'remotestoragejs';

/**
 * Keeps a local write from being lost when it lands while sync is pushing an
 * earlier version of the same document (#329).
 *
 * remotestoragejs holds one cache node per path, recording the local
 * version, the version being pushed and the last one the server confirmed.
 * Local writes update it through a queue, but Sync reads and rewrites the
 * same node outside that queue — when it starts a push (`doTask`) and when
 * the server answers (`handleResponse`). A write that falls between Sync's
 * read and its write is overwritten by the stale copy: the node ends up
 * marked as in sync, so the newer version is never pushed and the server
 * keeps the old one.
 *
 * This makes the three take turns per cache, so each sees the other's
 * finished result. None of them holds its turn across a network request,
 * and a call that finds nothing queued starts synchronously.
 */
type AsyncMethod = (this: object, ...args: unknown[]) => Promise<unknown>;
type Prototype = Record<string, AsyncMethod>;
type Class = { prototype: object };

const queues = new WeakMap<object, Promise<void>>();
const patched = new WeakSet<object>();

function takeTurns(
  proto: Prototype,
  names: string[],
  cacheOf: (self: object) => object,
): void {
  if (patched.has(proto)) return;
  patched.add(proto);
  for (const name of names) {
    const method = proto[name];
    proto[name] = function (...args) {
      const cache = cacheOf(this);
      // Start at once when nothing is queued: a pagehide flush must begin
      // its write before the page unloads, so it can't wait a microtask.
      const prev = queues.get(cache);
      const result = prev
        ? prev.then(() => method.apply(this, args))
        : method.apply(this, args);
      const settled = result.then(
        () => {},
        () => {},
      );
      queues.set(cache, settled);
      settled.then(() => {
        if (queues.get(cache) === settled) queues.delete(cache);
      });
      return result;
    };
  }
}

/** The prototype in `cls`'s chain that defines `name`. */
function ownerOf(cls: Class, name: string): Prototype {
  let proto = cls.prototype;
  while (!Object.hasOwn(proto, name)) proto = Object.getPrototypeOf(proto);
  return proto as Prototype;
}

/**
 * Make local writes and sync's cache bookkeeping run one at a time.
 * Call once, right after constructing the RemoteStorage instance.
 */
export function serializeCacheWrites(rs: RemoteStorage): void {
  const { Sync, IndexedDB, LocalStorage, InMemoryStorage } = (
    rs as unknown as { featureModules: Record<string, Class> }
  ).featureModules;

  takeTurns(
    ownerOf(Sync, 'doTask'),
    ['doTask', 'handleResponse'],
    (sync) => (sync as { rs: { local: object } }).rs.local,
  );
  for (const cache of [IndexedDB, LocalStorage, InMemoryStorage]) {
    takeTurns(ownerOf(cache, 'put'), ['put', 'delete'], (local) => local);
  }
}
