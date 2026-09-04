/**
 * Builds the git-installed Agent OS dependencies in place.
 *
 * npm's `prepare` handling for git dependencies is inconsistent across npm
 * versions, so instead of relying on it, the flagship's postinstall runs
 * `npm install && npm run build` inside each dependency package directory.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const root = path.dirname(url.fileURLToPath(new URL('.', import.meta.url)));
const packages = ['agent-kernel', 'engram', 'traceshield'];

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd} (exit ${result.status})`);
  }
}

for (const pkg of packages) {
  const dir = path.join(root, 'node_modules', pkg);
  if (!fs.existsSync(dir)) {
    console.error(`[bootstrap] ${pkg} not found in node_modules — run npm install first`);
    process.exit(1);
  }
  const hasDist = fs.existsSync(path.join(dir, 'dist'));
  if (hasDist) {
    console.log(`[bootstrap] ${pkg} already built`);
    continue;
  }
  console.log(`[bootstrap] building ${pkg}...`);
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir);
  run('npm', ['run', 'build'], dir);
  console.log(`[bootstrap] ${pkg} built`);
}

console.log('[bootstrap] all Agent OS dependencies ready');
