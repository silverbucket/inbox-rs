import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `dragDisabled` is not a per-zone option for `dragHandleZone`.
 *
 * svelte-dnd-action keeps it in a module-global store that every
 * `dragHandleZone` writes as it mounts and updates, and every `dragHandle`
 * reads. One component setting it therefore disables — or re-enables — the
 * grips in *every* other component on the page, with the last render winning.
 * Several of ours passed `dragDisabled: isTouchDevice`, which between them
 * killed grip dragging everywhere on touch, sidebar included.
 *
 * A handle zone doesn't need the flag anyway: a press that isn't on a grip
 * never starts a drag. Plain `dndzone` is a different matter — there the whole
 * item is draggable, the flag is local to that zone, and disabling it on touch
 * is the right call. So this only polices `dragHandleZone`.
 */
const COMPONENTS = join(import.meta.dirname, '.');

function svelteFiles(): string[] {
  return readdirSync(COMPONENTS).filter((f) => f.endsWith('.svelte'));
}

/** The text of each `use:dragHandleZone={{ ... }}` block in `source`. */
function handleZoneOptions(source: string): string[] {
  const blocks: string[] = [];
  const marker = 'use:dragHandleZone={{';
  let at = source.indexOf(marker);
  while (at !== -1) {
    let depth = 0;
    let i = at + marker.length - 2;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) break;
    }
    blocks.push(source.slice(at, i));
    at = source.indexOf(marker, i);
  }
  return blocks;
}

describe('dragHandleZone options', () => {
  it('finds the handle zones it is meant to police', () => {
    const total = svelteFiles().reduce(
      (n, file) =>
        n +
        handleZoneOptions(readFileSync(join(COMPONENTS, file), 'utf8')).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it('never passes dragDisabled, which is global to all handle zones', () => {
    const offenders: string[] = [];
    for (const file of svelteFiles()) {
      const source = readFileSync(join(COMPONENTS, file), 'utf8');
      for (const block of handleZoneOptions(source)) {
        // Strip `//` comments — they explain precisely why the flag is absent.
        const code = block.replace(/\/\/[^\n]*/g, '');
        if (/\bdragDisabled\b/.test(code)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
