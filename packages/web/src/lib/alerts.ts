import type { InboxItem } from '@inbox-rs/rs-module';
import { get, writable } from 'svelte/store';
import {
  ALERT_GRACE_MS,
  alertKey,
  collectDueAlerts,
  pruneFiredKeys,
} from './alerts-core';
import { now } from './now';
import { formatScheduled } from './schedule';
import { items } from './stores';
import { showToast } from './toast';

/**
 * The in-app due-alert scheduler. Watches the global `items` store (not any
 * view-filtered derivation) so a due todo alerts even when the active filter
 * hides it, and delivers on the shared `now` heartbeat: a toast always, plus
 * an OS notification when permission is granted. Client-side only — alerts
 * fire while a tab or installed PWA is open; there is no push server.
 *
 * Dedup state is device-local localStorage. It is re-read on every check
 * (and re-checked right before each write), so two open tabs converge on the
 * same fired set without a dedicated cross-tab channel; the OS-notification
 * `tag` collapses the residual race to a single banner.
 */

const FIRED_KEY = 'inbox-rs:alerts:fired';

function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export const alertPermission = writable<NotificationPermission | 'unsupported'>(
  notificationsSupported() ? Notification.permission : 'unsupported',
);

export async function requestAlertPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!notificationsSupported()) return 'unsupported';
  const result = await Notification.requestPermission();
  alertPermission.set(result);
  return result;
}

type OpenHandler = (item: InboxItem) => void;
let openHandler: OpenHandler | null = null;

/** App registers its card-modal opener so a toast's View action can jump
 *  straight to the due item. */
export function setAlertOpenHandler(fn: OpenHandler): void {
  openHandler = fn;
}

function loadFired(): Set<string> {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveFired(fired: Set<string>): void {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify([...fired]));
  } catch {
    // Storage unavailable — alerts may repeat next session; better than none.
  }
}

async function osNotify(item: InboxItem): Promise<void> {
  if (get(alertPermission) !== 'granted') return;
  const title = item.title || 'Untitled';
  const options = {
    body: `Due now · ${formatScheduled(item)}`,
    tag: alertKey(item),
  };
  // Prefer the SW registration (required on Android; works with the
  // generateSW worker since the call comes from the page), fall back to the
  // constructor where no registration exists (e.g. dev without SW).
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    // fall through to the constructor
  }
  try {
    new Notification(title, options);
  } catch {
    // Notification constructor throws on some platforms (Android) — the
    // toast already delivered the alert in-app.
  }
}

function deliver(due: InboxItem[]): void {
  if (due.length === 1) {
    const item = due[0];
    showToast(`Due now: ${item.title || 'Untitled'}`, {
      label: 'View',
      run: () => openHandler?.(item),
    });
  } else {
    showToast(`${due.length} items due now`, {
      label: 'View',
      run: () => {
        window.location.hash = '#/todos';
      },
    });
  }
  for (const item of due) void osNotify(item);
}

function check(): void {
  const map = get(items);
  const fired = loadFired();
  const { fire, expire } = collectDueAlerts(
    Object.values(map),
    fired,
    Date.now(),
    ALERT_GRACE_MS,
  );
  if (fire.length === 0 && expire.length === 0) return;

  // Re-read right before writing: another tab may have fired these between
  // our load and now.
  const fresh = loadFired();
  const deliverable = fire.filter((item) => !fresh.has(alertKey(item)));
  for (const item of deliverable) fresh.add(alertKey(item));
  for (const key of expire) fresh.add(key);
  saveFired(fresh);

  if (deliverable.length > 0) deliver(deliverable);
}

let initialized = false;

/**
 * Start the scheduler. Idempotent; call once from the app shell. Subscribes
 * to `items` (new/edited schedules re-check immediately) and `now` (the 30s
 * heartbeat, which also ticks on visibilitychange → visible).
 */
export function initAlerts(): void {
  if (initialized) return;
  initialized = true;

  // One-time hygiene: drop fired keys for deleted/rescheduled/ancient items.
  // Deferred until items actually load — at startup the store is empty, and
  // pruning against it would wipe every key and re-fire old alerts.
  let pruned = false;
  items.subscribe((map) => {
    if (!pruned && Object.keys(map).length > 0) {
      pruned = true;
      const fired = loadFired();
      const kept = pruneFiredKeys([...fired], map, Date.now());
      if (kept.length !== fired.size) saveFired(new Set(kept));
    }
    check();
  });
  now.subscribe(check);
}
