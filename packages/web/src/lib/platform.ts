/** True on macOS. Prefers the modern UA-Client-Hints platform, falls back to
 *  navigator.platform, and defaults to false when neither is available. */
export function isMac(): boolean {
  const nav = globalThis.navigator as
    | (Navigator & { userAgentData?: { platform?: string } })
    | undefined;
  const p = nav?.userAgentData?.platform || nav?.platform || '';
  return /mac/i.test(p);
}

/** The Enter modifier key label for the current platform. */
export function modLabel(): '⌘' | 'Ctrl' {
  return isMac() ? '⌘' : 'Ctrl';
}
