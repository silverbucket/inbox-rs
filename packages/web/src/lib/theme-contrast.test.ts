import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENTS, PALETTES } from './theme';

/**
 * WCAG contrast guard for the theme tokens. Parses the real stylesheets so a
 * new accent or palette can't ship text that's unreadable in either mode —
 * accent text on dark surfaces once sat at 1.3–3.2:1.
 */

const css = (name: string) =>
  readFileSync(new URL(`../styles/${name}`, import.meta.url), 'utf8');
const accentsCss = css('theme-accents.css');
const palettesCss = css('theme-palettes.css');
const globalCss = css('global.css');

const MIN = 4.5;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull `--name: #hex` declarations out of the first block matching `selector`. */
function tokens(source: string, selector: string): Record<string, string> {
  const start = source.indexOf(selector);
  if (start < 0) throw new Error(`missing ${selector}`);
  const body = source.slice(
    source.indexOf('{', start) + 1,
    source.indexOf('}', start),
  );
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

/** Paper (global.css) is the base; other palettes override its neutrals. */
function palette(name: string, mode: 'dark' | 'light') {
  const base =
    mode === 'dark'
      ? tokens(globalCss, ':root {')
      : tokens(globalCss, ':root[data-theme="light"]');
  if (name === 'paper') return base;
  return {
    ...base,
    ...(mode === 'dark'
      ? tokens(palettesCss, `:root[data-palette="${name}"] {`)
      : tokens(
          palettesCss,
          `:root[data-palette="${name}"][data-theme="light"]`,
        )),
  };
}

const surfaces = (t: Record<string, string>) => [
  t['--bg'],
  t['--sidebar-bg'],
  t['--surface'],
  t['--surface-hover'],
];

describe('theme contrast', () => {
  for (const mode of ['dark', 'light'] as const) {
    for (const name of PALETTES) {
      const t = palette(name, mode);

      it(`${name} ${mode}: text, muted and status text are readable`, () => {
        for (const token of [
          '--text',
          '--text-muted',
          '--danger-text',
          '--ok-text',
          '--warn-text',
        ]) {
          for (const bg of surfaces(t)) {
            expect(
              contrast(t[token], bg),
              `${token} on ${bg}`,
            ).toBeGreaterThanOrEqual(MIN);
          }
        }
      });

      it(`${name} ${mode}: every accent is readable as text`, () => {
        for (const accent of ACCENTS) {
          const fg = tokens(accentsCss, `:root[data-accent="${accent}"]`)[
            `--accent-text-${mode}`
          ];
          for (const bg of surfaces(t)) {
            expect(
              contrast(fg, bg),
              `${accent} on ${bg}`,
            ).toBeGreaterThanOrEqual(MIN);
          }
        }
      });
    }
  }

  it('white text stays readable on every accent fill and its hover', () => {
    for (const accent of ACCENTS) {
      const t = tokens(accentsCss, `:root[data-accent="${accent}"]`);
      for (const token of ['--accent', '--accent-deep']) {
        expect(
          contrast('#ffffff', t[token]),
          `${accent} ${token}`,
        ).toBeGreaterThanOrEqual(MIN);
      }
    }
  });
});
