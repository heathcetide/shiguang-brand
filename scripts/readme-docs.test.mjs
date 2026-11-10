import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkCommands, checkLinks, entryDocuments, localTargets, replaceToolchain, run, toolchainBlock } from './readme-docs.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'readme-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of entryDocuments) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), '');
  }
  writeFileSync(path.join(root, '.nvmrc'), '22.23.2\n');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.18.0', scripts: { dev: 'example' } }));
  writeFileSync(path.join(root, 'docs/status.md'), '[README](../README.md)');
  for (const name of ['README.md', 'README.en.md']) {
    writeFileSync(path.join(root, name), `Human introduction\n${toolchainBlock(root, name === 'README.en.md')}\n| \`pnpm dev\` | Start |\nHuman footer\n`);
  }
  return root;
}

test('current entry documents pass', () => run());
test('both languages derive versions from sources and generation preserves prose', t => {
  const root = fixture(t);
  run({ root });
  writeFileSync(path.join(root, '.nvmrc'), '22.24.0\n');
  assert.throws(() => run({ root }), /generated block drift/);
  run({ root, write: true });
  run({ root });
  for (const name of ['README.md', 'README.en.md']) {
    const generated = readFileSync(path.join(root, name), 'utf8');
    assert.match(generated, /Node.js 22.24.0/);
    assert.ok(generated.startsWith('Human introduction\n'));
    assert.ok(generated.endsWith('Human footer\n'));
    run({ root, write: true });
    assert.equal(readFileSync(path.join(root, name), 'utf8'), generated);
  }
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json')));
  pkg.packageManager = 'pnpm@10.19.0';
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  assert.throws(() => run({ root }), /generated block drift/);
  run({ root, write: true });
  assert.match(readFileSync(path.join(root, 'README.en.md'), 'utf8'), /corepack prepare pnpm@10.19.0/);
});
test('missing, duplicate, and reversed markers fail instead of overwriting prose', () => {
  const begin = '<!-- BEGIN GENERATED:toolchain -->';
  const end = '<!-- END GENERATED:toolchain -->';
  for (const source of ['Human text', `${begin}${begin}${end}`, `${end}${begin}`]) {
    assert.throws(() => replaceToolchain(source, 'generated'));
  }
});
test('checks Markdown and HTML links but ignores external URLs, anchors, and fenced code', t => {
  const root = fixture(t);
  const source = '[readme](../README.md#intro) <a href="../README.en.md">English</a> [web](https://example.org) [anchor](#heading)\n```text\n[example](missing.md)\n```';
  assert.deepEqual(localTargets(source), ['../README.md', '../README.en.md']);
  checkLinks(root, 'docs/status.md', source);
  assert.throws(() => checkLinks(root, 'README.md', '[missing](missing.md)'), /missing local link/);
  assert.throws(() => checkLinks(root, 'README.md', '[outside](../outside.md)'), /escapes repository/);
  assert.throws(() => checkLinks(root, 'README.md', '<img src="missing.svg" />'), /missing local link/);
});
test('selected command table catches renamed or removed package scripts', () => {
  checkCommands('| `pnpm dev` | Start |', { dev: 'example' }, 'README.md');
  assert.throws(() => checkCommands('| `pnpm missing` | Start |', {}, 'README.md'), /unknown command/);
});
test('malformed toolchain sources fail clearly', t => {
  const root = fixture(t);
  writeFileSync(path.join(root, '.nvmrc'), 'lts/*');
  assert.throws(() => toolchainBlock(root, false), /exact Node version/);
  writeFileSync(path.join(root, '.nvmrc'), '22.23.2');
  writeFileSync(path.join(root, 'package.json'), '{"packageManager":"npm@latest"}');
  assert.throws(() => toolchainBlock(root, false), /exact pnpm version/);
});

test('maintained guides are included in local link checks', t => {
  const root = fixture(t);
  writeFileSync(path.join(root, 'docs/operations.md'), '[missing](missing-guide.md)');
  assert.throws(() => run({ root }), /operations.md: missing local link/);
});
