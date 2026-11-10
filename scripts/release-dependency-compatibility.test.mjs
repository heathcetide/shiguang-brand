import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const clientRequire = createRequire(new URL('../client/package.json', import.meta.url));
const expoRequire = createRequire(clientRequire.resolve('expo/package.json'));
const cliRequire = createRequire(expoRequire.resolve('@expo/cli'));

test('React Native codegen discovers and parses a native TypeScript spec', () => {
  const rnRequire = createRequire(clientRequire.resolve('react-native/package.json'));
  const { combineSchemasInFileList } = rnRequire('@react-native/codegen/lib/cli/combine/combine-js-to-schema');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddd-codegen-'));
  try {
    fs.writeFileSync(path.join(root, 'NativeSample.ts'), `
      import type {TurboModule} from 'react-native';
      import {TurboModuleRegistry} from 'react-native';
      export interface Spec extends TurboModule { ping(value: string): void; }
      export default TurboModuleRegistry.getEnforcing<Spec>('Sample');
    `);
    const schema = combineSchemasInFileList([root], 'android');
    assert.equal(schema.modules.NativeSample.type, 'NativeModule');
    assert.equal(schema.modules.NativeSample.moduleName, 'Sample');
    fs.writeFileSync(path.join(root, 'Sample.podspec'), 's.ios.deployment_target = "15.1"');
    const rnRoot = path.dirname(clientRequire.resolve('react-native/package.json'));
    const { extractSupportedApplePlatforms } = clientRequire(path.join(rnRoot, 'scripts/codegen/generate-artifacts-executor/generateSchemaInfos.js'));
    assert.equal(extractSupportedApplePlatforms('Sample', root).ios, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('React Native can load the updated Edge launcher and Expo can match file patterns', () => {
  const middlewareRequire = createRequire(cliRequire.resolve('@react-native/dev-middleware'));
  const { Launcher } = middlewareRequire('chromium-edge-launcher');
  assert.equal(typeof Launcher.getFirstInstallation, 'function');
  // Loads the real CommonJS consumer of the ESM launcher without opening a browser.
  assert.equal(typeof cliRequire('@react-native/dev-middleware').createDevMiddleware, 'function');
  const { minimatch, Minimatch } = cliRequire('minimatch');
  assert.equal(minimatch('app/index.tsx', '**/*.{ts,tsx}'), true);
  assert.equal(minimatch('app/index.js', '**/*.{ts,tsx}'), false);
  const matcher = new Minimatch('a/**/../'.repeat(16) + 'file', { optimizationLevel: 2, braceExpandMax: 64 });
  assert.ok(matcher.globParts.length <= 64, 'preprocessing must respect its expansion budget');
});

test('Expo glob stops filesystem traversal after cancellation', async () => {
  const configRequire = createRequire(cliRequire.resolve('@expo/config-plugins'));
  const { glob } = configRequire('glob');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddd-glob-abort-'));
  const controller = new AbortController();
  let reads = 0;
  try {
    for (let i = 0; i < 4; i++) fs.mkdirSync(path.join(root, `${i}`, 'nested'), { recursive: true });
    await assert.rejects(glob('**/*', {
      cwd: root,
      signal: controller.signal,
      fs: {
        readdir(directory, options, callback) {
          reads++;
          fs.readdir(directory, options, (error, entries) => {
            controller.abort(new Error('test traversal cancelled'));
            callback(error, entries);
          });
        },
      },
    }), /test traversal cancelled/);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(reads, 1, 'aborted traversal must not read child directories');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Axios redirect dependency strips cross-realm custom sensitive headers', async () => {
  const axiosRequire = createRequire(clientRequire.resolve('axios'));
  const { http } = axiosRequire('follow-redirects');
  let redirectedHeaders;
  const server = createServer((request, response) => {
    if (request.url === '/start') {
      response.writeHead(302, { location: `http://localhost:${server.address().port}/end` });
    } else redirectedHeaders = request.headers;
    response.end();
  });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    await new Promise((resolve, reject) => {
      const request = http.get(`http://127.0.0.1:${server.address().port}/start`, {
        headers: { 'x-private-token': 'local-fixture', 'x-public-value': 'preserved' },
        sensitiveHeaders: vm.runInNewContext('["x-private-token"]'),
      }, response => { response.resume(); response.on('end', resolve); });
      request.on('error', reject);
      request.setTimeout(5000, () => request.destroy(new Error('redirect test timed out')));
    });
    assert.equal(redirectedHeaders['x-private-token'], undefined);
    assert.equal(redirectedHeaders['x-public-value'], 'preserved');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
