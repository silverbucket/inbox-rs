import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Explicit file lists avoid AppleDouble/resource forks and accidental dotfiles.
export function archiveFiles(root, relative = '') {
  return readdirSync(join(root, relative))
    .sort()
    .flatMap((name) => {
      if (
        name.startsWith('.') ||
        name === '__MACOSX' ||
        name === 'node_modules' ||
        name === 'dist'
      )
        return [];
      const path = join(relative, name);
      const stat = lstatSync(join(root, path));
      if (stat.isSymbolicLink())
        throw new Error(`Refusing to archive symlink: ${path}`);
      return stat.isDirectory() ? archiveFiles(root, path) : [path];
    });
}

export function archiveDirectory(sourceDir, targetFile) {
  const files = archiveFiles(sourceDir).sort();
  if (!files.length) throw new Error(`Empty archive: ${sourceDir}`);
  const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? 315532964);
  if (!Number.isInteger(epoch) || epoch < 315532800 || epoch > 4354819198)
    throw new Error(
      'SOURCE_DATE_EPOCH must be a valid ZIP timestamp (1980–2107)',
    );
  const staging = mkdtempSync(join(tmpdir(), 'inbox-rs-archive-'));
  try {
    for (const file of files) {
      const destination = join(staging, file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(sourceDir, file), destination);
      chmodSync(destination, 0o644);
      utimesSync(destination, epoch, epoch);
    }
    const target = resolve(targetFile);
    rmSync(target, { force: true });
    execFileSync('zip', ['-X', '-D', '-q', target, '-@'], {
      cwd: staging,
      input: `${files.join('\n')}\n`,
      env: { ...process.env, TZ: 'UTC', COPYFILE_DISABLE: '1' },
    });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
