// Bind OAuth callbacks to a short-lived attempt in this browser tab.
const PENDING_KEY = 'inbox-rs:pending-oauth';
const MAX_AGE_MS = 15 * 60 * 1000;
const CALLBACK_KEYS = new Set([
  'error',
  'error_description',
  'error_uri',
  'access_token',
  'token_type',
  'expires_in',
  'scope',
  'code',
  'state',
  'rsDiscovery',
]);

type PendingAuthorization = {
  state: string;
  returnState: string;
  createdAt: number;
};

/** Store a callback nonce before redirecting; unavailable storage fails closed. */
export function beginOAuthAuthorization(returnState: string): string {
  const state = crypto.randomUUID();
  const pending: PendingAuthorization = {
    state,
    returnState,
    createdAt: Date.now(),
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  return state;
}

/**
 * Run before constructing remoteStorage, which otherwise trusts URL errors and
 * tokens without checking OAuth state. Preserve unrelated query/hash routing.
 * Valid callbacks are consumed once and get their original route state back.
 */
export function guardOAuthCallback(): void {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const params = new URLSearchParams(url.search);
  for (const [key, value] of fragment) params.set(key, value);
  if (
    !['error', 'access_token', 'code', 'rsDiscovery'].some((key) =>
      params.has(key),
    )
  )
    return;

  let pending: PendingAuthorization | undefined;
  try {
    const saved = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
    if (
      saved &&
      typeof saved.state === 'string' &&
      typeof saved.returnState === 'string' &&
      typeof saved.createdAt === 'number'
    ) {
      pending = saved;
    }
  } catch {
    // Missing/corrupt/unavailable session storage cannot authorize a callback.
  }
  const age = pending ? Date.now() - pending.createdAt : Infinity;
  const trusted =
    pending &&
    params.get('state') === pending.state &&
    age >= 0 &&
    age <= MAX_AGE_MS;

  if (trusted) {
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      // If the nonce cannot be consumed, reject the callback below.
      pending = undefined;
    }
  }
  if (trusted && pending) {
    // remoteStorage uses state to restore the hash, so never pass our nonce
    // through as an application route. Prefer fragment state as the library does.
    url.searchParams.delete('state');
    fragment.set('state', pending.returnState);
    url.hash = fragment.toString();
  } else {
    for (const key of CALLBACK_KEYS) url.searchParams.delete(key);
    // Avoid serializing hash routes as URLSearchParams (which encodes '/?').
    url.hash = url.hash
      .slice(1)
      .split('&')
      .filter((part) => {
        const key = new URLSearchParams(part).keys().next().value;
        return !key || !CALLBACK_KEYS.has(key);
      })
      .join('&');
  }
  window.history.replaceState(window.history.state, '', url);
}
