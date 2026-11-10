import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} must be ${expected}, received ${actual || '<empty>'}`);
  }
}

const nodeVersion = read('.nvmrc').trim();
const packageJson = JSON.parse(read('package.json'));
const packageManager = String(packageJson.packageManager || '');
const pnpmVersion = packageManager.startsWith('pnpm@') ? packageManager.slice('pnpm@'.length) : '';

requireEqual(read('.node-version').trim(), nodeVersion, '.node-version');
requireEqual(String(packageJson.engines?.node || ''), nodeVersion, 'package.json engines.node');
requireEqual(String(packageJson.engines?.pnpm || ''), pnpmVersion, 'package.json engines.pnpm');

for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/android-apk.yml']) {
  const source = read(workflow);
  if (!source.includes(`node-version: ${nodeVersion}`)) {
    throw new Error(`${workflow} must use Node ${nodeVersion}`);
  }
  if (!source.includes(`version: ${pnpmVersion}`)) {
    throw new Error(`${workflow} must use pnpm ${pnpmVersion}`);
  }
  for (const action of source.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)) {
    if (!/^[0-9a-f]{40}$/.test(action[2])) {
      throw new Error(`${workflow} must pin ${action[1]} to a full commit SHA`);
    }
  }
}

console.log(`Toolchain declarations agree on Node ${nodeVersion} and pnpm ${pnpmVersion}.`);
