import { writable } from 'svelte/store';

export interface ToastState {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export const toast = writable<ToastState | null>(null);

const TIMEOUT_MS = 5000;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(
  message: string,
  action?: { label: string; run: () => void },
): void {
  if (timer) clearTimeout(timer);
  const id = ++seq;
  toast.set({ id, message, action });
  timer = setTimeout(() => {
    toast.update((t) => (t?.id === id ? null : t));
  }, TIMEOUT_MS);
}

export function dismissToast(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  toast.set(null);
}
