import { getDemoLogin } from './demoLogin';

const originalEnvironment = { ...process.env };
const originalDev = __DEV__;
afterEach(() => {
  process.env = { ...originalEnvironment };
  Object.assign(globalThis, { __DEV__: originalDev });
});

test('local credentials require both explicit public fields', () => {
  Object.assign(globalThis, { __DEV__: true });
  delete process.env.EXPO_PUBLIC_DEMO_LOGIN_IDENTIFIER;
  delete process.env.EXPO_PUBLIC_DEMO_LOGIN_PASSWORD;
  expect(getDemoLogin()).toBeNull();
  process.env.EXPO_PUBLIC_DEMO_LOGIN_IDENTIFIER = ' demo@example.test ';
  expect(getDemoLogin()).toBeNull();
  process.env.EXPO_PUBLIC_DEMO_LOGIN_PASSWORD = 'DisposableDemo123';
  expect(getDemoLogin()).toEqual({ identifier: 'demo@example.test', password: 'DisposableDemo123' });
});

test('production ignores even explicitly supplied demo credentials', () => {
  Object.assign(globalThis, { __DEV__: false });
  process.env.EXPO_PUBLIC_DEMO_LOGIN_IDENTIFIER = 'demo@example.test';
  process.env.EXPO_PUBLIC_DEMO_LOGIN_PASSWORD = 'DisposableDemo123';
  expect(getDemoLogin()).toBeNull();
});
