import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

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
  const files = archiveFiles(sourceDir);
  if (!files.length) throw new Error(`Empty archive: ${sourceDir}`);
  rmSync(targetFile, { force: true });
  execFileSync('zip', ['-X', '-q', targetFile, '-@'], {
    cwd: sourceDir,
    input: `${files.join('\n')}\n`,
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
}
