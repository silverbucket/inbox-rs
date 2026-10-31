import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENTS, PALETTES } from './theme';

/**
 * WCAG contrast guard for the theme tokens. Parses the real stylesheets so a
 * new accent or palette can't ship text that's unreadable in either mode —
 * accent text on dark surfaces once sat at 1.3–3.2:1. Text is checked on the
 * plain neutral surfaces and on those surfaces under the strongest tint the
 * components put behind it (e.g. --accent-subtle-strong on hover).
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

/** `color-mix(in srgb, fg p, transparent)` composited over `bg`. */
function tint(fg: string, bg: string, p: number): string {
  return `#${[1, 3, 5]
    .map((i) => {
      const [f, b] = [fg, bg].map((c) =>
        Number.parseInt(c.slice(i, i + 2), 16),
      );
      return Math.round(f * p + b * (1 - p))
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

/** Strongest tints behind each text token (see --accent-subtle-strong). */
const ACCENT_TINT = 0.26;
const DANGER_TINT = 0.1;
const WARN_TINT = 0.16;

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** All `--name: value` declarations in the first block matching `selector`. */
function declarations(
  source: string,
  selector: string,
): Record<string, string> {
  const start = source.indexOf(selector);
  if (start < 0) throw new Error(`missing ${selector}`);
  const body = source.slice(
    source.indexOf('{', start) + 1,
    source.indexOf('}', start),
  );
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]),
  );
}

/** Just the `--name: #hex` declarations. */
function tokens(source: string, selector: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(declarations(source, selector)).filter(([, v]) =>
      /^#[0-9a-f]{6}$/i.test(v),
    ),
  );
}

/** Explicit and system-preference light blocks for each stylesheet. */
const LIGHT_BLOCKS: [source: string, explicit: string, system: string][] = [
  [globalCss, ':root[data-theme="light"]', ':root:not([data-theme="dark"])'],
  ...PALETTES.filter((p) => p !== 'paper').map(
    (p) =>
      [
        palettesCss,
        `:root[data-palette="${p}"][data-theme="light"]`,
        `:root[data-palette="${p}"]:not([data-theme="dark"])`,
      ] as [string, string, string],
  ),
];

/** Paper (global.css) is the base; other palettes override its neutrals. */
function palette(name: string, mode: 'dark' | 'light') {
  const root = tokens(globalCss, ':root {');
  const base =
    mode === 'dark'
      ? root
      : { ...root, ...tokens(globalCss, ':root[data-theme="light"]') };
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
        const backgrounds: Record<string, string[]> = {
          '--danger-text': surfaces(t).flatMap((bg) => [
            bg,
            tint(t['--danger'], bg, DANGER_TINT),
          ]),
          '--warn-text': surfaces(t).flatMap((bg) => [
            bg,
            tint(t['--warn'], bg, WARN_TINT),
          ]),
        };
        for (const token of [
          '--text',
          '--text-muted',
          '--danger-text',
          '--ok-text',
          '--warn-text',
        ]) {
          for (const bg of backgrounds[token] ?? surfaces(t)) {
            expect(
              contrast(t[token], bg),
              `${token} on ${bg}`,
            ).toBeGreaterThanOrEqual(MIN);
          }
        }
      });

      it(`${name} ${mode}: every accent is readable as text`, () => {
        for (const accent of ACCENTS) {
          const a = tokens(accentsCss, `:root[data-accent="${accent}"]`);
          const fg = a[`--accent-text-${mode}`];
          for (const bg of surfaces(t).flatMap((s) => [
            s,
            tint(a['--accent'], s, ACCENT_TINT),
          ])) {
            expect(
              contrast(fg, bg),
              `${accent} on ${bg}`,
            ).toBeGreaterThanOrEqual(MIN);
          }
        }
      });
    }
  }

  it('system-preference light blocks match the explicit light blocks', () => {
    for (const [source, explicit, system] of LIGHT_BLOCKS) {
      expect(declarations(source, system), system).toEqual(
        declarations(source, explicit),
      );
    }
  });

  it('--accent-text points at the shade for its mode', () => {
    expect(declarations(globalCss, ':root {')['--accent-text']).toBe(
      'var(--accent-text-dark)',
    );
    for (const selector of [
      ':root[data-theme="light"]',
      ':root:not([data-theme="dark"])',
    ]) {
      expect(declarations(globalCss, selector)['--accent-text']).toBe(
        'var(--accent-text-light)',
      );
    }
  });

  it('selected text stays readable on the selection tint', () => {
    for (const mode of ['dark', 'light'] as const) {
      const selection = declarations(
        globalCss,
        mode === 'dark' ? ':root {' : ':root[data-theme="light"]',
      )['--selection'];
      const pct = selection.match(/var\(--accent\) (\d+)%/)?.[1];
      expect(pct, selection).toBeDefined();
      for (const name of PALETTES) {
        const t = palette(name, mode);
        for (const accent of ACCENTS) {
          const fill = tokens(accentsCss, `:root[data-accent="${accent}"]`)[
            '--accent'
          ];
          for (const bg of surfaces(t)) {
            expect(
              contrast(t['--text'], tint(fill, bg, Number(pct) / 100)),
              `${name} ${mode} ${accent} on ${bg}`,
            ).toBeGreaterThanOrEqual(MIN);
          }
        }
      }
    }
  });

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
