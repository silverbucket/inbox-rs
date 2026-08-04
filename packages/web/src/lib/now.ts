import { readable } from 'svelte/store';

/**
 * A shared wall-clock heartbeat. Everything time-reactive (overdue styling,
 * the due band, the alert scheduler) hangs off this one store instead of
 * running its own interval. 30s is deliberate: alerts may land up to 30s
 * late, which nobody notices, and recomputing from the wall clock each tick
 * makes device sleep and clock changes non-issues.
 */
const TICK_MS = 30_000;

export const now = readable(new Date(), (set) => {
  const tick = () => set(new Date());
  const interval = setInterval(tick, TICK_MS);
  // A backgrounded tab throttles intervals; refresh immediately on return
  // so stale "due in 5 min" states don't linger after a long sleep.
  const onVisibility = () => {
    if (document.visibilityState === 'visible') tick();
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibility);
  };
});

function startOfDay(d: Date): number {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return t.getTime();
}

/**
 * Local midnight of the current day, in epoch ms. Emits only when the date
 * actually changes, so derived stores (the due band) can depend on "today"
 * without re-deriving every 30 seconds.
 */
export const todayStart = readable(startOfDay(new Date()), (set) => {
  let current = startOfDay(new Date());
  set(current);
  return now.subscribe((d) => {
    const next = startOfDay(d);
    if (next !== current) {
      current = next;
      set(next);
    }
  });
});
