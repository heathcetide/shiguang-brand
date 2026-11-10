import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const entryDocuments = [
  'README.md', 'README.en.md', 'docs/status.md', 'TODO.md', 'CONTRIBUTING.md',
  'admin/README.md', 'docs/testing.md', 'docs/operations.md',
  'docs/postgresql-migration.md', 'docs/preview-signing-verification.md',
  'docs/device-beta-checklist.md', 'docs/product-roadmap.md',
];
const begin = '<!-- BEGIN GENERATED:toolchain -->';
const end = '<!-- END GENERATED:toolchain -->';
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));

export function toolchainBlock(root, english) {
  const node = readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(node, /^\d+\.\d+\.\d+$/, 'Expected an exact Node version in .nvmrc');
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager);
  assert.ok(match, 'Expected an exact pnpm version in packageManager');
  const pnpm = match[1];
  return [begin,
    english ? '### Requirements' : '### 环境要求', '',
    `- Node.js ${node} (${english ? 'source' : '来源'}: [.nvmrc](.nvmrc))`,
    `- pnpm ${pnpm} (${english ? 'source' : '来源'}: [package.json](package.json))`, '',
    english ? '### Install and configure' : '### 安装与配置', '',
    '```bash', 'corepack enable', `corepack prepare pnpm@${pnpm} --activate`,
    'pnpm install --frozen-lockfile', 'cp client/.env.example client/.env',
    'cp server/.env.example server/.env', '```', end].join('\n');
}

export function replaceToolchain(source, block) {
  assert.equal(source.split(begin).length, 2, 'Expected exactly one toolchain start marker');
  assert.equal(source.split(end).length, 2, 'Expected exactly one toolchain end marker');
  const start = source.indexOf(begin);
  const finish = source.indexOf(end);
  assert.ok(finish > start, 'Toolchain markers are out of order');
  return source.slice(0, start) + block + source.slice(finish + end.length);
}

// Entry documents use inline Markdown links and HTML href/src. Ignore code
// samples and comments; this checks file targets, not remote URLs or anchors.
export function localTargets(source) {
  const prose = source.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const targets = [
    ...Array.from(prose.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g), m => m[1].replace(/^<|>$/g, '')),
    ...Array.from(prose.matchAll(/\b(?:href|src)=["']([^"']+)["']/g), m => m[1]),
  ];
  return targets.filter(target => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target))
    .map(target => decodeURIComponent(target.split(/[?#]/, 1)[0])).filter(Boolean);
}

export function checkLinks(root, name, source) {
  for (const target of localTargets(source)) {
    const resolved = path.resolve(root, path.dirname(name), target);
    const relative = path.relative(root, resolved);
    assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${name}: link escapes repository: ${target}`);
    assert.ok(existsSync(resolved), `${name}: missing local link target: ${target}`);
  }
}

export function checkCommands(source, scripts, name) {
  for (const match of source.matchAll(/^\|\s*`pnpm ([\w:-]+)`\s*\|/gm)) {
    assert.ok(Object.hasOwn(scripts, match[1]), `${name}: unknown command pnpm ${match[1]}`);
  }
}

export function run({ root = defaultRoot, write = false } = {}) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const name of entryDocuments) {
    const file = path.join(root, name);
    const source = readFileSync(file, 'utf8');
    let expected = source;
    if (name.startsWith('README')) {
      expected = replaceToolchain(source, toolchainBlock(root, name === 'README.en.md'));
      if (write && expected !== source) writeFileSync(file, expected);
      else assert.equal(source, expected, `${name}: generated block drift; run pnpm docs:generate`);
      checkCommands(expected, pkg.scripts, name);
    }
    checkLinks(root, name, expected);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--write'), 'Usage: node scripts/readme-docs.mjs [--write]');
  run({ write: args.includes('--write') });
  console.log('README toolchain blocks, local link targets, and listed commands are consistent.');
}
