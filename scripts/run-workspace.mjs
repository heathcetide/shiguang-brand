#!/usr/bin/env node
/**
 * Run a package script from the monorepo root with any of npm / yarn / bun / pnpm.
 * Usage: node scripts/run-workspace.mjs <dir> <script> [...args]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [dir, script, ...extra] = process.argv.slice(2);

if (!dir || !script) {
  console.error('Usage: node scripts/run-workspace.mjs <dir> <script> [...args]');
  process.exit(1);
}

const cwd = path.join(root, dir);
const npmExecPath = process.env.npm_execpath || '';
const userAgent = process.env.npm_config_user_agent || '';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (userAgent.includes('bun') || /(?:^|[\\/])bun(?:\.exe)?$/i.test(npmExecPath) || npmExecPath.includes('bun')) {
  run('bun', ['run', script, ...extra]);
}
if (userAgent.startsWith('yarn/') || npmExecPath.includes('yarn')) {
  run('yarn', ['run', script, ...extra]);
}
if (userAgent.includes('pnpm') || npmExecPath.includes('pnpm')) {
  run('pnpm', ['run', script, ...extra]);
}
run('npm', ['run', script, ...extra]);
