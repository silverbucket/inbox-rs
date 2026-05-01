import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * iOS Safari auto-zooms the viewport when a focused <input>/<textarea>/<select>
 * has a computed font-size below 16px (1rem at the 16px root default), and
 * that zoom doesn't reset on blur — it persists and breaks the layout.
 *
 * What this test enforces: every CSS rule that targets a form control AND
 * explicitly declares `font-size` with a numeric literal must declare it at
 * >= 1rem. The detector intentionally does NOT flag:
 *
 * - Rules that omit `font-size` entirely (they inherit from the root, which
 *   `global.css` sets to 16px / 17px on narrow viewports — safe).
 * - Rules that set the size via the `font` shorthand. We don't use the
 *   shorthand for form controls anywhere in the repo today.
 * - Rules where the value is a CSS-wide keyword (`inherit`, `initial`,
 *   `unset`, `revert`, `currentcolor`).
 * - Rules where the value is a `var(--…)` custom property. We can't
 *   statically resolve the variable's value (or its fallback chain) without
 *   building a real CSS-cascade evaluator, so any `var()` is treated as
 *   compliant. This is a real gap — if someone introduces
 *   `font-size: var(--foo)` on a form control and `--foo` resolves below
 *   1rem, this test won't catch it. Today the codebase has zero uses of
 *   `font-size: var(…)` (verified by grep at the time of writing); avoid
 *   introducing one for a form control unless you can guarantee the variable
 *   never resolves below 1rem.
 *
 * See AGENTS.md → "Form controls: never below 1rem".
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname = .../packages/web/src/lib  →  repo root is four levels up.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

const SCAN_DIRS = [
  join(REPO_ROOT, 'packages/web/src'),
  join(REPO_ROOT, 'packages/extension/src'),
  join(REPO_ROOT, 'packages/thunderbird/src'),
];

/*
 * Class-only selectors that are applied to <input>/<textarea>/<select> in the
 * markup but don't include an input-element token in their name. Add an entry
 * here when you introduce such a class. Selectors like `.abbrev-input` and
 * `.code-input` are handled automatically by INPUT_ELEMENT_RE (both contain
 * `\binput\b` because `-` is a word boundary).
 */
const NAMED_INPUT_CLASSES = ['search'];

const INPUT_ELEMENT_RE = /\b(?:input|textarea|select)\b/;

function selectorTargetsFormControl(selector: string): boolean {
  if (INPUT_ELEMENT_RE.test(selector)) return true;
  return NAMED_INPUT_CLASSES.some((cls) =>
    new RegExp(`\\.${cls}\\b`).test(selector),
  );
}

function isBelow1rem(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (/^(inherit|initial|unset|revert|currentcolor)$/.test(trimmed))
    return false;
  if (trimmed.startsWith('var(')) return false;
  const m = trimmed.match(/^(\d+(?:\.\d+)?)(rem|em|px|%)?$/);
  if (!m) return false;
  const num = Number.parseFloat(m[1]);
  const unit = m[2] ?? '';
  if (unit === 'px') return num < 16;
  if (unit === '%') return num < 100;
  return num < 1;
}

function collectStyleFiles(dir: string, accum: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git')
      continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectStyleFiles(fullPath, accum);
    } else if (fullPath.endsWith('.svelte') || fullPath.endsWith('.css')) {
      accum.push(fullPath);
    }
  }
  return accum;
}

interface CssChunk {
  text: string;
  offset: number;
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, ' '),
  );
}

function svelteStyleChunks(source: string): CssChunk[] {
  const chunks: CssChunk[] = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/g;
  let m = re.exec(source);
  while (m !== null) {
    const bodyOffset = m.index + m[0].indexOf(m[1]);
    chunks.push({ text: m[1], offset: bodyOffset });
    m = re.exec(source);
  }
  return chunks;
}

interface Violation {
  file: string;
  line: number;
  selector: string;
  declaration: string;
}

function findViolations(
  file: string,
  source: string,
  chunk: CssChunk,
): Violation[] {
  const violations: Violation[] = [];
  const css = stripCssComments(chunk.text);
  const ruleRe = /([^{}\s][^{}]*?)\s*\{([^{}]*)\}/g;
  let m = ruleRe.exec(css);
  while (m !== null) {
    const selector = m[1].trim();
    if (!selector.startsWith('@') && selectorTargetsFormControl(selector)) {
      const body = m[2];
      const fsRe = /font-size\s*:\s*([^;}]+?)\s*(?:!important)?\s*(?:;|$)/gi;
      let fs = fsRe.exec(body);
      while (fs !== null) {
        const value = fs[1].trim();
        if (isBelow1rem(value)) {
          const declAbsOffset =
            chunk.offset + m.index + m[0].indexOf(body) + fs.index;
          const line = source.slice(0, declAbsOffset).split('\n').length;
          violations.push({
            file,
            line,
            selector,
            declaration: `font-size: ${value}`,
          });
        }
        fs = fsRe.exec(body);
      }
    }
    m = ruleRe.exec(css);
  }
  return violations;
}

function findFileViolations(file: string): Violation[] {
  const source = readFileSync(file, 'utf-8');
  if (file.endsWith('.svelte')) {
    return svelteStyleChunks(source).flatMap((chunk) =>
      findViolations(file, source, chunk),
    );
  }
  return findViolations(file, source, { text: source, offset: 0 });
}

describe('form-control font-size floor (iOS Safari focus-zoom prevention)', () => {
  it('no form-control rule explicitly declares font-size below 1rem', () => {
    const files = SCAN_DIRS.flatMap((d) => collectStyleFiles(d));
    const violations = files.flatMap(findFileViolations);
    const formatted = violations.map(
      (v) =>
        `${relative(REPO_ROOT, v.file)}:${v.line}  {${v.selector}}  ${v.declaration}`,
    );
    expect(
      formatted,
      'Form-control rules must not declare font-size below 1rem (iOS Safari ' +
        'focus-zoom).\nSee AGENTS.md → "Form controls: never below 1rem".\n' +
        `Violations:\n  ${formatted.join('\n  ')}`,
    ).toEqual([]);
  });

  describe('detector self-tests', () => {
    it('selectorTargetsFormControl matches form-control selectors', () => {
      const positives = [
        'input',
        'textarea',
        'select',
        'input, textarea',
        'input:focus',
        'input::placeholder',
        "input[type='text']",
        ".form :global(input[type='text'])",
        '.connect-form input',
        '.abbrev-input',
        '.code-input',
        '.search',
        '.search:focus',
      ];
      for (const sel of positives) {
        expect(selectorTargetsFormControl(sel), sel).toBe(true);
      }
    });

    it('selectorTargetsFormControl ignores non-form-control selectors', () => {
      const negatives = [
        '.btn-primary',
        '.title',
        'h2',
        '.modal',
        '.add-strip',
      ];
      for (const sel of negatives) {
        expect(selectorTargetsFormControl(sel), sel).toBe(false);
      }
    });

    it('isBelow1rem treats values correctly', () => {
      expect(isBelow1rem('0.85rem')).toBe(true);
      expect(isBelow1rem('0.99rem')).toBe(true);
      expect(isBelow1rem('1rem')).toBe(false);
      expect(isBelow1rem('1.0rem')).toBe(false);
      expect(isBelow1rem('1.1rem')).toBe(false);
      expect(isBelow1rem('15px')).toBe(true);
      expect(isBelow1rem('15.9px')).toBe(true);
      expect(isBelow1rem('16px')).toBe(false);
      expect(isBelow1rem('17px')).toBe(false);
      expect(isBelow1rem('0.9em')).toBe(true);
      expect(isBelow1rem('1em')).toBe(false);
      expect(isBelow1rem('99%')).toBe(true);
      expect(isBelow1rem('100%')).toBe(false);
      expect(isBelow1rem('inherit')).toBe(false);
      expect(isBelow1rem('initial')).toBe(false);
      expect(isBelow1rem('var(--font-size)')).toBe(false);
    });

    it('catches a synthetic rem violation', () => {
      const css = '.ok-style {} input { font-size: 0.85rem; }';
      const v = findViolations('fake.svelte', css, { text: css, offset: 0 });
      expect(v).toHaveLength(1);
      expect(v[0].selector).toBe('input');
      expect(v[0].declaration).toBe('font-size: 0.85rem');
    });

    it('catches a sub-16px violation', () => {
      const css = 'textarea { font-size: 14px; }';
      const v = findViolations('fake.svelte', css, { text: css, offset: 0 });
      expect(v).toHaveLength(1);
    });

    it('does not flag a 1rem rule', () => {
      const css = 'input { font-size: 1rem; }';
      const v = findViolations('fake.svelte', css, { text: css, offset: 0 });
      expect(v).toEqual([]);
    });

    it('does not flag font-size on non-form-control rules', () => {
      const css = '.title { font-size: 0.85rem; }';
      const v = findViolations('fake.svelte', css, { text: css, offset: 0 });
      expect(v).toEqual([]);
    });

    it('honors !important values', () => {
      const css = 'input { font-size: 0.5rem !important; }';
      const v = findViolations('fake.svelte', css, { text: css, offset: 0 });
      expect(v).toHaveLength(1);
      expect(v[0].declaration).toBe('font-size: 0.5rem');
    });

    it('handles rules nested inside @media', () => {
      const css = '@media (max-width: 600px) { input { font-size: 0.7rem; } }';
      const v = findViolations('fake.svelte', css, { text: css, offset: 0 });
      expect(v).toHaveLength(1);
    });

    it('ignores braces inside CSS comments', () => {
      const css =
        '/* example: input { font-size: 0.5rem } */ .ok { color: red; }';
      const v = findViolations('fake.svelte', css, { text: css, offset: 0 });
      expect(v).toEqual([]);
    });
  });
});
