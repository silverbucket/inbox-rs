import { type Readable, writable } from 'svelte/store';

/** remotestorage.js keeps the wireclient session (incl. token) under this key. */
const WIRECLIENT_KEY = 'remotestorage:wireclient';

/**
 * True when remotestorage.js will try to resume a session on boot: the
 * wireclient settings hold a token. Disconnect deletes the key, so a
 * signed-out user reads false here.
 */
export function hasStoredSession(): boolean {
  try {
    const raw = localStorage.getItem(WIRECLIENT_KEY);
    return !!raw && !!JSON.parse(raw)?.token;
  } catch {
    return false;
  }
}

/**
 * Startup "still restoring" signal. True until the first local load has
 * finished and, when a stored session exists, until RS has reported how the
 * session resolved (connected, not-connected, disconnected or error). A
 * safety timeout clears it so it can never stick.
 */
export function createRestoring(opts: {
  sessionPending: boolean;
  timeoutMs?: number;
}): {
  restoring: Readable<boolean>;
  localLoaded: () => void;
  sessionSettled: () => void;
} {
  let localPending = true;
  let sessionPending = opts.sessionPending;
  const store = writable(true);
  const done = () => {
    clearTimeout(timer);
    store.set(false);
  };
  const timer = setTimeout(done, opts.timeoutMs ?? 3000);
  const check = () => {
    if (!localPending && !sessionPending) done();
  };
  return {
    restoring: { subscribe: store.subscribe },
    localLoaded: () => {
      localPending = false;
      check();
    },
    sessionSettled: () => {
      sessionPending = false;
      check();
    },
  };
}
