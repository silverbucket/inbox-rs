import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' });
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

describe('web deployment safety', () => {
  it('carries every immutable deployed asset forward without retaining maps', () => {
    const repo = mkdtempSync(join(tmpdir(), 'inbox-rs-deploy-'));
    run('git', ['init'], repo);
    run('git', ['config', 'user.name', 'Test'], repo);
    run('git', ['config', 'user.email', 'test@example.com'], repo);
    write(join(repo, 'assets/release-1.js'), 'release one');
    write(join(repo, 'assets/release-1.js.map'), 'large source map');
    run('git', ['add', '.'], repo);
    run('git', ['commit', '-m', 'deployed release'], repo);

    const dist = join(repo, 'dist');
    write(join(dist, 'assets/release-5.js'), 'release five');
    run(
      'node',
      [join(scriptsDir, 'retain-deployed-web-assets.mjs'), 'HEAD', dist],
      repo,
    );

    expect(readFileSync(join(dist, 'assets/release-1.js'), 'utf8')).toBe(
      'release one',
    );
    expect(readFileSync(join(dist, 'assets/release-5.js'), 'utf8')).toBe(
      'release five',
    );
    expect(() => readFileSync(join(dist, 'assets/release-1.js.map'))).toThrow();
  });

  it('replaces every historical HTML entry bundle with a recovery shim', () => {
    const repo = mkdtempSync(join(tmpdir(), 'inbox-rs-shims-'));
    run('git', ['init'], repo);
    run('git', ['config', 'user.name', 'Test'], repo);
    run('git', ['config', 'user.email', 'test@example.com'], repo);
    write(
      join(repo, 'index.html'),
      '<script type="module" src="/assets/main-release-1.js"></script>',
    );
    write(
      join(repo, 'capture/index.html'),
      '<script type="module" src="/assets/capture-release-1.js"></script>',
    );
    run('git', ['add', '.'], repo);
    run('git', ['commit', '-m', 'release one'], repo);
    write(
      join(repo, 'index.html'),
      '<script type="module" src="/assets/main-release-2.js"></script>',
    );
    run('git', ['add', '.'], repo);
    run('git', ['commit', '-m', 'release two'], repo);

    const dist = join(repo, 'dist');
    write(
      join(dist, 'asset-manifest.json'),
      JSON.stringify({
        'src/main.ts': { file: 'assets/main-current.js', isEntry: true },
        'src/capture/main.ts': {
          file: 'assets/capture-current.js',
          isEntry: true,
        },
      }),
    );
    write(join(dist, 'assets/main-current.js'), 'current main');
    write(join(dist, 'assets/capture-current.js'), 'current capture');

    run(
      'node',
      [join(scriptsDir, 'create-deployed-entry-shims.mjs'), 'HEAD', dist],
      repo,
    );

    for (const historicalEntry of [
      'main-release-1.js',
      'main-release-2.js',
      'capture-release-1.js',
      // Known staging entry whose cached HTML caused the original white
      // screen; keep its rescue path permanently covered.
      'main-DVGRcOrn.js',
    ]) {
      expect(
        readFileSync(join(dist, 'assets', historicalEntry), 'utf8'),
      ).toContain("import '/app-loader.js'");
    }
    expect(readFileSync(join(dist, 'assets/main-current.js'), 'utf8')).toBe(
      'current main',
    );
  });

  it('rejects a deployment whose manifest points at a missing entry', () => {
    const dist = mkdtempSync(join(tmpdir(), 'inbox-rs-invalid-deploy-'));
    write(
      join(dist, 'index.html'),
      '<div id="app"></div><script src="/app-loader.js"></script>',
    );
    write(
      join(dist, 'capture/index.html'),
      '<div id="capture-app"></div><script src="/app-loader.js"></script>',
    );
    write(join(dist, 'app-loader.js'), '/* stable */');
    write(join(dist, 'sw.js'), '/* worker */');
    write(
      join(dist, 'asset-manifest.json'),
      JSON.stringify({
        'src/main.ts': { file: 'assets/missing.js', isEntry: true },
        'src/capture/main.ts': {
          file: 'assets/capture.js',
          isEntry: true,
        },
      }),
    );
    write(join(dist, 'assets/capture.js'), '/* capture */');

    expect(() =>
      run('node', [join(scriptsDir, 'check-web-deploy.mjs'), dist], dist),
    ).toThrow();
  });

  it('accepts a complete stable-loader deployment', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'inbox-rs-valid-deploy-'));
    write(
      join(fixture, 'index.html'),
      '<div id="app"></div><script src="/app-loader.js"></script>',
    );
    write(
      join(fixture, 'capture/index.html'),
      '<div id="capture-app"></div><script src="/app-loader.js"></script>',
    );
    write(join(fixture, 'app-loader.js'), '/* stable */');
    write(join(fixture, 'sw.js'), '/* worker */');
    write(join(fixture, 'assets/main.js'), '/* main */');
    write(join(fixture, 'assets/capture.js'), '/* capture */');
    write(
      join(fixture, 'asset-manifest.json'),
      JSON.stringify({
        'src/main.ts': { file: 'assets/main.js', isEntry: true },
        'src/capture/main.ts': {
          file: 'assets/capture.js',
          isEntry: true,
        },
      }),
    );
    expect(
      run('node', [join(scriptsDir, 'check-web-deploy.mjs'), fixture], fixture),
    ).toContain('internally consistent');
  });
});
