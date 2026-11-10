import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const clientRequire = createRequire(new URL('../client/package.json', import.meta.url));
let consumerRequire = clientRequire;
for (const dependency of ['react-native', 'babel-jest']) {
  consumerRequire = createRequire(consumerRequire.resolve(dependency));
}
const pluginPath = consumerRequire.resolve('babel-plugin-istanbul');
const { loadNycConfig } = createRequire(pluginPath)('@istanbuljs/load-nyc-config');

function fixture(context) {
  // Babel resolves real paths; match macOS /var -> /private/var for fixture files.
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dietdigidose-nyc-')));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'nyc-fixture', nyc: { 'check-coverage': true } }));
  writeFileSync(join(cwd, 'base.yaml'), 'all: true\nexclude-node-modules: false\nrequire: ./setup.js\n');
  writeFileSync(join(cwd, '.nycrc.yml'), 'extends: ./base.yaml\ninclude: src/**/*.js\nexclude:\n  - "**/*.test.js"\nreporter: [text, lcov]\n');
  return cwd;
}

test('React Native NYC loader preserves YAML inheritance and rejects unsafe JS tags', async context => {
  const cwd = fixture(context);
  assert.deepEqual(await loadNycConfig({ cwd }), {
    cwd, checkCoverage: true, all: true, excludeNodeModules: false, require: ['./setup.js'],
    include: ['src/**/*.js'], exclude: ['**/*.test.js'], reporter: ['text', 'lcov'],
  });
  writeFileSync(join(cwd, 'invalid.yaml'), 'include: [\n');
  await assert.rejects(loadNycConfig({ cwd, nycrcPath: 'invalid.yaml' }), { name: 'YAMLException' });
  writeFileSync(join(cwd, 'unsafe.yaml'), 'include: !!js/regexp /src/\n');
  await assert.rejects(loadNycConfig({ cwd, nycrcPath: 'unsafe.yaml' }), /unknown tag/);
});

test('Babel Istanbul child process loads YAML and honors instrumentation exclusions', context => {
  const cwd = fixture(context);
  mkdirSync(join(cwd, 'src'));
  for (const file of ['plus.js', 'plus.test.js']) {
    writeFileSync(join(cwd, 'src', file), 'export const plus = (a, b) => a + b;');
  }
  const babel = clientRequire('@babel/core');
  const options = { babelrc: false, configFile: false, plugins: [[pluginPath, { cwd }]] };
  assert.match(babel.transformFileSync(join(cwd, 'src/plus.js'), options).code, /__coverage__/);
  assert.doesNotMatch(babel.transformFileSync(join(cwd, 'src/plus.test.js'), options).code, /__coverage__/);
});

test('development depcheck retains its legacy safeLoad consumers', async context => {
  const cwd = fixture(context);
  const depcheckRequire = createRequire(clientRequire.resolve('depcheck'));
  const { parse } = depcheckRequire('./utils/cli-tools');
  assert.deepEqual(parse('extends: standard\nplugins:\n  - react\n'), { extends: 'standard', plugins: ['react'] });
  const travis = join(cwd, '.travis.yml');
  writeFileSync(travis, 'before_install: pnpm install\nscript:\n  - pnpm test\n  - pnpm lint\n');
  const getScripts = depcheckRequire('./utils/get-scripts').default;
  assert.deepEqual(await getScripts(travis), ['pnpm install', 'pnpm test', 'pnpm lint']);
});
