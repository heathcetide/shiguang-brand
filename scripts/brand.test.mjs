import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file));
const sha = file => createHash('sha256').update(read(file)).digest('hex');

function png(file) {
  const bytes = read(file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

test('retired display branding appears only in root README history', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root }).toString().split('\0');
  // Code points keep the retired name out of current source text.
  const retired = new RegExp(`${String.fromCodePoint(0x98df, 0x5149)}|SHI[G]UANG`);
  const unexpected = [...new Set(files)].filter(file => {
    if (['README.md', 'README.en.md'].includes(file) || file.startsWith('.claude/')) return false;
    if (!/\.(?:tsx?|jsx?|mjs|cjs|py|json|md|html|css|ya?ml|toml|sql|svg)$/.test(file)) return false;
    return existsSync(resolve(root, file)) && retired.test(read(file).toString());
  });
  assert.deepEqual(unexpected, []);
  for (const file of ['README.md', 'README.en.md']) {
    const text = read(file).toString();
    assert.ok(text.includes('拾味日常'));
    assert.equal(text.split(String.fromCodePoint(0x98df, 0x5149, 0x70d9, 0x8bb0)).length - 1, 1);
  }
});

test('Expo display brand changes without changing installation or update identities', () => {
  const require = createRequire(import.meta.url);
  const original = { ...process.env };
  try {
    for (const key of ['EXPO_PUBLIC_APP_NAME', 'EXPO_PUBLIC_APP_SLUG', 'EXPO_PUBLIC_ANDROID_PACKAGE', 'EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER']) delete process.env[key];
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.example.test';
    const configPath = require.resolve('../client/app.config.js');
    for (const profile of ['production', 'preview']) {
      process.env.EAS_BUILD_PROFILE = profile;
      delete require.cache[configPath];
      const config = require(configPath)({ config: {} });
      assert.equal(config.name, '拾味日常');
      const id = profile === 'preview' ? 'com.dietdigidose.app.preview' : 'com.dietdigidose.app';
      assert.equal(config.android.package, id);
      assert.equal(config.ios.bundleIdentifier, id);
      assert.equal(config.scheme, 'dietdigidose');
      assert.equal(config.extra.eas.projectId, 'c89b45c8-5a27-4f6f-af05-4b656f534994');
      assert.equal(config.android.adaptiveIcon.backgroundColor, '#fffdf9');
      const notifications = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-notifications')[1];
      assert.equal(notifications.icon, './assets/images/notification-icon.png');
      assert.equal(config.android.adaptiveIcon.monochromeImage, './assets/images/adaptive-icon-monochrome.png');
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test('admin, client and both API logo assets are identical', () => {
  for (const file of ['admin/public/logo.png', 'server/assets/logo.png', 'server/pkg/apidocs/assets/logo.png']) {
    assert.equal(sha(file), sha('client/assets/logo.png'), file);
  }
  assert.deepEqual(png('client/assets/logo.png'), { width: 512, height: 512, colorType: 6 });
  for (const file of ['admin/public/favicon.svg', 'server/pkg/apidocs/assets/logo.svg']) assert.equal(sha(file), sha('client/assets/logo.svg'));
  const svg = read('client/assets/logo.svg').toString();
  assert.match(svg, /<path/);
  assert.doesNotMatch(svg, /<image|base64/);
});

test('launcher, adaptive, splash and notification icons have platform-specific dimensions', () => {
  for (const name of ['icon', 'adaptive-icon', 'adaptive-icon-safe']) {
    assert.deepEqual(png(`client/assets/images/${name}.png`), { width: 1024, height: 1024, colorType: 2 });
  }
  for (const name of ['adaptive-icon-foreground', 'adaptive-icon-monochrome', 'splash-icon', 'splash-icon-safe']) {
    assert.deepEqual(png(`client/assets/images/${name}.png`), { width: 1024, height: 1024, colorType: 6 });
  }
  assert.deepEqual(png('client/assets/images/notification-icon.png'), { width: 96, height: 96, colorType: 6 });
  assert.equal(png('client/assets/images/favicon.png').width, 64);
});

test('admin logo links share a rebrand cache version', () => {
  const asset = read('admin/src/assets.ts').toString();
  const logo = asset.match(/'(\/logo\.png\?v=[^']+)'/)?.[1];
  assert.ok(logo?.includes('shiwei-daily'));
  assert.equal(read('admin/index.html').toString().split(logo).length - 1, 3);
});

test('new APK labels use the current brand while signing and package identity stay unchanged', () => {
  const workflow = read('.github/workflows/android-apk.yml').toString();
  assert.match(workflow, /artifact\/ShiweiDaily-/);
  assert.match(workflow, /APK_PATH="ShiweiDaily-/);
  assert.match(workflow, /name: ShiweiDaily-Android-/);
  assert.ok(workflow.includes('com.dietdigidose.app.preview'));
});
