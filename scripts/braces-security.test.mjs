import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const clientRequire = createRequire(new URL('../client/package.json', import.meta.url));
const consumers = [
  ['Expo/Metro', ['expo', '@expo/metro-config', 'metro', 'metro-file-map']],
  ['Jest core', ['jest', 'jest-cli', '@jest/core']],
  ['Jest config', ['jest', 'jest-cli', 'jest-config']],
  ['Jest file map', ['jest', 'jest-cli', '@jest/core', 'jest-haste-map']],
  ['Jest diagnostics', ['jest', 'jest-cli', '@jest/core', 'jest-message-util']],
  ['Jest transform', ['jest', 'jest-cli', '@jest/core', 'jest-runtime', '@jest/transform']],
  ['Development HTTP proxy', ['http-proxy-middleware']],
  ['Dependency inspection', ['depcheck', 'findup-sync']],
];

// Follow installed consumers instead of testing an unrelated top-level copy.
// Consumers sharing the same resolved pair need only one expensive regression run.
const copies = new Map();
for (const [name, chain] of consumers) {
  let require = clientRequire;
  for (const dependency of chain) require = createRequire(require.resolve(dependency));
  const micromatchPath = require.resolve('micromatch');
  const bracesPath = createRequire(micromatchPath).resolve('braces');
  const key = JSON.stringify([micromatchPath, bracesPath]);
  if (!copies.has(key)) copies.set(key, { names: [], micromatchPath, bracesPath });
  copies.get(key).names.push(name);
}

function isolated(copy, check) {
  const result = spawnSync(process.execPath, ['-e', `(${check.toString()})()`, copy.bracesPath, copy.micromatchPath], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

for (const copy of copies.values()) {
  const consumer = copy.names.join(', ');
  test(`${consumer}: bounded rejection of deep patterns through public APIs`, () => isolated(copy, () => {
    const assert = require('node:assert/strict');
    const braces = require(process.argv[1]);
    const micromatch = require(process.argv[2]);
    // Stay below the existing 10,000-character limit, which does not prevent stack exhaustion.
    const depth = 4000;
    const bracesClosed = '{'.repeat(depth) + 'a,b' + '}'.repeat(depth);
    const parensClosed = '('.repeat(depth) + 'x' + ')'.repeat(depth);
    const cases = [
      ['main', () => braces(bracesClosed)],
      ['parse parentheses', () => braces.parse(parensClosed)],
      ['stringify braces', () => braces.stringify(bracesClosed)],
      ['compile parentheses', () => braces.compile(parensClosed)],
      ['expand braces', () => braces.expand(bracesClosed)],
      ['parse unclosed braces', () => braces.parse('{'.repeat(depth) + 'a,b')],
      ['compile unclosed parentheses', () => braces.compile('('.repeat(depth) + 'x')],
      ['expand dollar literal', () => braces.expand('${' + parensClosed + '}')],
      ['parse range fallback', () => braces.parse('{a..b' + parensClosed + ',c}')],
      ['micromatch braces', () => micromatch.braces(bracesClosed)],
      ['micromatch expand', () => micromatch.braceExpand(bracesClosed)],
    ];
    for (const [name, run] of cases) {
      assert.throws(run, error => /nesting depth/i.test(error.message) && !/call stack/i.test(error.message), name);
    }
    const boundary = depth => '{'.repeat(depth) + 'x' + '}'.repeat(depth);
    assert.equal(braces.stringify(boundary(63)), boundary(63));
    assert.throws(() => braces.stringify(boundary(64)), /nesting depth/i);
    for (const maxDepth of [Infinity, NaN]) {
      assert.throws(() => braces.compile(boundary(64), { maxDepth }), /nesting depth/i);
    }
  }));

  test(`${consumer}: direct ASTs cannot bypass traversal bounds`, () => isolated(copy, () => {
    const assert = require('node:assert/strict');
    const braces = require(process.argv[1]);
    const rejects = (run, name) => assert.throws(run,
      error => /nesting depth/i.test(error.message) && !/call stack/i.test(error.message), name);
    const nested = () => {
      let node = { type: 'text', value: 'x' };
      for (let i = 0; i < 4000; i++) {
        const parent = { type: 'paren', nodes: [node] };
        node.parent = parent;
        node = parent;
      }
      const root = { type: 'root', nodes: [node] };
      node.parent = root;
      return root;
    };
    for (const method of ['stringify', 'compile', 'expand']) {
      rejects(() => braces[method](nested()), method + ' nested AST');
      const cycle = { type: 'root', nodes: [] };
      cycle.nodes.push(cycle);
      rejects(() => braces[method](cycle), method + ' cyclic nodes');
    }
    const dollar = { type: 'brace', dollar: true, nodes: [nested()] };
    rejects(() => braces.expand({ type: 'root', nodes: [dollar] }), 'literal AST stringify fallback');
    const parentCycle = { type: 'paren', nodes: [{ type: 'text', value: 'x' }] };
    parentCycle.parent = parentCycle;
    rejects(() => braces.expand({ type: 'root', nodes: [parentCycle] }), 'cyclic parent links');
    for (const prefix of [[], [{ type: 'text', value: 'prefix' }]]) {
      let value = 'x';
      for (let i = 0; i < 4000; i++) value = [value];
      rejects(() => braces.expand({ type: 'root', nodes: [...prefix, { type: 'text', value }] }),
        prefix.length ? 'append nested arrays' : 'flatten nested arrays');
    }
  }));

  test(`${consumer}: ordinary glob, ranges, escaping and shallow ASTs remain compatible`, () => {
    const braces = clientRequire(copy.bracesPath);
    const micromatch = clientRequire(copy.micromatchPath);
    const pattern = 'src/{client,server}/file-{1..3}.ts';
    const expected = ['client', 'server'].flatMap(directory => [1, 2, 3].map(i => `src/${directory}/file-${i}.ts`));
    assert.deepEqual(braces.expand(pattern), expected);
    assert.deepEqual(micromatch.braceExpand(pattern), expected);
    assert.deepEqual(micromatch([...expected, 'src/other/file-1.ts', 'src/client/file-4.ts'], pattern), expected);
    assert.equal(braces.stringify(braces.parse(pattern)), pattern);
    const compiled = new RegExp('^' + braces.compile(braces.parse(pattern)) + '$');
    for (const path of expected) assert.equal(compiled.test(path), true);
    assert.equal(compiled.test('src/other/file-1.ts'), false);
    assert.deepEqual(braces.expand(String.raw`literal-\{a,b\}`), ['literal-{a,b}']);
    assert.deepEqual(braces.expand('v{01..03}'), ['v01', 'v02', 'v03']);
    const shallow = '('.repeat(20) + 'x' + ')'.repeat(20);
    assert.equal(braces.stringify(braces.parse(shallow)), shallow);
    assert.deepEqual(braces.expand(braces.parse('a/{b,c}/d')), ['a/b/d', 'a/c/d']);
  });
}
