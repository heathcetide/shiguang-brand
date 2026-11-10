import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// Resolve through real consumers so overrides and pnpm patches are exercised.
const clientRequire = createRequire(new URL('../client/package.json', import.meta.url));
const routerRequire = createRequire(clientRequire.resolve('expo-router/package.json'));
const queryString = routerRequire('query-string');

test('Expo Router query-string consumer decodes query parameters', () => {
  assert.deepEqual({ ...queryString.parse('id=42&name=%E9%A3%9F%E5%85%89&tag=a&tag=b&empty=&space=a+b') }, {
    id: '42', name: '食光', tag: ['a', 'b'], empty: '', space: 'a b',
  });
});

test('decoder preserves malformed escapes without rescanning decoded output', () => {
  assert.equal(queryString.parse('value=%2541%ZZ').value, '%41%ZZ');
});

test('React Navigation parses a detail route with query parameters', async () => {
  const nativeRequire = createRequire(routerRequire.resolve('@react-navigation/native'));
  const coreEntry = pathToFileURL(nativeRequire.resolve('@react-navigation/core'));
  const { getStateFromPath } = await import(new URL('./getStateFromPath.js', coreEntry));
  const state = getStateFromPath('/post-detail?id=42&name=%E9%A3%9F', { screens: { Post: 'post-detail' } });
  assert.equal(state.routes[0].name, 'Post');
  assert.deepEqual(state.routes[0].params, { id: '42', name: '食' });
});
