import { describe, it, expect } from 'vitest';
import { classifyChanges, planBumps } from './release-bump.mjs';

/**
 * `release-bump.mjs` is the single point of truth for "which package
 * version actually moves on a release". The pure functions
 * `classifyChanges` and `planBumps` carry that logic — testing them
 * directly keeps the assertion close to the rule we want to enforce.
 *
 * Regression scenarios pinned here:
 *   - web-only releases must not bump extension versions (avoids burning
 *     store-version numbers on no-op extension uploads).
 *   - rs-module changes must propagate to BOTH extensions (they bundle it).
 *   - extension/thunderbird change in isolation only bumps the affected one.
 */

describe('classifyChanges', () => {
  it('returns all-false when nothing relevant changed (web-only or root-only)', () => {
    expect(
      classifyChanges([
        'packages/web/src/App.svelte',
        'packages/web/src/lib/stores.ts',
      ]),
    ).toEqual({
      rsModuleChanged: false,
      extensionNeedsBump: false,
      thunderbirdNeedsBump: false,
    });
  });

  it('flags both extensions when rs-module changes (shared dep)', () => {
    expect(
      classifyChanges(['packages/rs-module/src/runtime.ts']),
    ).toEqual({
      rsModuleChanged: true,
      extensionNeedsBump: true,
      thunderbirdNeedsBump: true,
    });
  });

  it('flags only extension when extension code changes', () => {
    expect(
      classifyChanges(['packages/extension/src/popup/Popup.svelte']),
    ).toEqual({
      rsModuleChanged: false,
      extensionNeedsBump: true,
      thunderbirdNeedsBump: false,
    });
  });

  it('flags only thunderbird when thunderbird code changes', () => {
    expect(
      classifyChanges(['packages/thunderbird/manifest.json']),
    ).toEqual({
      rsModuleChanged: false,
      extensionNeedsBump: false,
      thunderbirdNeedsBump: true,
    });
  });

  it('treats root config / docs / scripts / .github as web-only (no extension bump)', () => {
    expect(
      classifyChanges([
        'README.md',
        'CLAUDE.md',
        'package.json',
        'package-lock.json',
        'scripts/release-bump.mjs',
        '.github/workflows/release.yml',
        'docker-compose.yml',
      ]),
    ).toEqual({
      rsModuleChanged: false,
      extensionNeedsBump: false,
      thunderbirdNeedsBump: false,
    });
  });

  it('combines signals across multiple changed files', () => {
    expect(
      classifyChanges([
        'packages/web/src/App.svelte', // web-only
        'packages/extension/src/lib/rs.ts', // extension only
      ]),
    ).toEqual({
      rsModuleChanged: false,
      extensionNeedsBump: true,
      thunderbirdNeedsBump: false,
    });
  });

  it('handles empty input', () => {
    expect(classifyChanges([])).toEqual({
      rsModuleChanged: false,
      extensionNeedsBump: false,
      thunderbirdNeedsBump: false,
    });
  });

  it('does not match prefix-only false positives', () => {
    // `packages/extension-foo/...` should NOT trip `packages/extension/`.
    // We rely on the trailing slash in the prefix.
    expect(
      classifyChanges(['packages/extension-foo/manifest.json']),
    ).toEqual({
      rsModuleChanged: false,
      extensionNeedsBump: false,
      thunderbirdNeedsBump: false,
    });
  });
});

describe('planBumps', () => {
  /** Pluck just the relative paths out of a plan, in deterministic order. */
  function paths(plan) {
    return plan.map((p) => p.file);
  }

  it('always bumps root, web, rs-module, and scripts', () => {
    const plan = planBumps('9.9.9', {
      rsModuleChanged: false,
      extensionNeedsBump: false,
      thunderbirdNeedsBump: false,
    });

    expect(paths(plan)).toEqual([
      'package.json',
      'packages/web/package.json',
      'packages/rs-module/package.json',
      'scripts/package.json',
    ]);
    expect(plan.every((p) => p.version === '9.9.9')).toBe(true);
  });

  it('adds extension files when extensionNeedsBump is true', () => {
    const plan = planBumps('9.9.9', {
      rsModuleChanged: false,
      extensionNeedsBump: true,
      thunderbirdNeedsBump: false,
    });

    expect(paths(plan)).toEqual(
      expect.arrayContaining([
        'packages/extension/package.json',
        'packages/extension/manifest.json',
        'packages/extension/manifest.firefox.json',
      ]),
    );
    expect(paths(plan)).not.toContain('packages/thunderbird/package.json');
  });

  it('adds thunderbird files when thunderbirdNeedsBump is true', () => {
    const plan = planBumps('9.9.9', {
      rsModuleChanged: false,
      extensionNeedsBump: false,
      thunderbirdNeedsBump: true,
    });

    expect(paths(plan)).toEqual(
      expect.arrayContaining([
        'packages/thunderbird/package.json',
        'packages/thunderbird/manifest.json',
      ]),
    );
    expect(paths(plan)).not.toContain('packages/extension/package.json');
  });

  it('bumps every artifact when both flags are true (rs-module change)', () => {
    const plan = planBumps('9.9.9', {
      rsModuleChanged: true,
      extensionNeedsBump: true,
      thunderbirdNeedsBump: true,
    });

    expect(paths(plan)).toEqual([
      'package.json',
      'packages/web/package.json',
      'packages/rs-module/package.json',
      'scripts/package.json',
      'packages/extension/package.json',
      'packages/extension/manifest.json',
      'packages/extension/manifest.firefox.json',
      'packages/thunderbird/package.json',
      'packages/thunderbird/manifest.json',
    ]);
  });

  it('writes the same version string to every entry', () => {
    const plan = planBumps('1.2.3-beta.4', {
      rsModuleChanged: true,
      extensionNeedsBump: true,
      thunderbirdNeedsBump: true,
    });
    expect(plan.every((p) => p.version === '1.2.3-beta.4')).toBe(true);
  });
});

describe('end-to-end policy (web-only release scenario)', () => {
  /**
   * REGRESSION: this is the whole point of the script. A web-only release
   * (CSS tweaks, copy edits) must not move the extension manifests at all.
   */
  it('a web-only diff produces a plan that leaves extensions pinned', () => {
    const changedFiles = [
      'packages/web/src/App.svelte',
      'packages/web/src/components/PluginsPage.svelte',
      'packages/web/src/styles/main.css',
    ];
    const plan = planBumps('2.2.0', classifyChanges(changedFiles));
    const files = plan.map((p) => p.file);

    expect(files).not.toContain('packages/extension/package.json');
    expect(files).not.toContain('packages/extension/manifest.json');
    expect(files).not.toContain('packages/extension/manifest.firefox.json');
    expect(files).not.toContain('packages/thunderbird/package.json');
    expect(files).not.toContain('packages/thunderbird/manifest.json');
  });

  it('an rs-module diff produces a plan that bumps everything', () => {
    const changedFiles = ['packages/rs-module/src/runtime.ts'];
    const plan = planBumps('2.2.0', classifyChanges(changedFiles));
    const files = plan.map((p) => p.file);

    expect(files).toContain('packages/extension/manifest.json');
    expect(files).toContain('packages/extension/manifest.firefox.json');
    expect(files).toContain('packages/thunderbird/manifest.json');
  });
});
