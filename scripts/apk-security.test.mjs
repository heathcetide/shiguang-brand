import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const cropImageActivity = 'com.canhub.cropper.CropImageActivity';
const toolsNamespace = 'http://schemas.android.com/tools';

function manifestWithComponents() {
  return { manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android', package: 'com.dietdigidose.app' },
    application: [{
      $: { 'android:name': '.MainApplication', 'tools:replace': 'android:allowBackup' },
      activity: [
        { $: { 'android:name': '.MainActivity', 'android:exported': 'true' }, 'intent-filter': [{
          action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
        }] },
        { $: {
          'android:name': 'expo.modules.imagepicker.ExpoCropImageActivity',
          'android:exported': 'false', 'android:theme': '@style/Base.Theme.AppCompat',
          'tools:replace': 'android:exported',
        } },
      ],
      service: [{ $: {
        'android:name': 'expo.modules.notifications.service.ExpoFirebaseMessagingService',
        'android:exported': 'false',
      } }],
      receiver: [{ $: {
        'android:name': 'com.google.firebase.iid.FirebaseInstanceIdReceiver',
        'android:exported': 'true', 'android:permission': 'com.google.android.c2dm.permission.SEND',
        'tools:replace': 'android:exported',
      }, 'intent-filter': [{ action: [{ $: { 'android:name': 'com.google.android.c2dm.intent.RECEIVE' } }] }] }],
      provider: [{ $: {
        'android:name': 'com.canhub.cropper.CropFileProvider',
        'android:authorities': '${applicationId}.cropper.fileprovider',
        'android:exported': 'false', 'android:grantUriPermissions': 'true',
      } }],
    }],
  } };
}

test('production APK gate passes safe synthetic artifacts and rejects unsafe fixtures', () => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_apk_security.py', '-v'], {
    cwd: root, encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});

test('security plugin applies and writes the exact rules inspected in APK fixtures', async () => {
  const { applySecurityPolicy, writeSecurityRules } = require('../client/plugins/withAndroidArtifactSecurity.js');
  const manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication', 'android:allowBackup': 'true' } }] } };
  const result = applySecurityPolicy(manifest);
  assert.deepEqual(result.manifest.application[0].$, {
    'android:name': '.MainApplication', 'android:allowBackup': 'false',
    'android:fullBackupContent': '@xml/ddd_backup_rules',
    'android:dataExtractionRules': '@xml/ddd_data_extraction_rules',
    'android:networkSecurityConfig': '@xml/ddd_network_security_config',
  });
  const directory = await mkdtemp(join(tmpdir(), 'ddd-backup-policy-'));
  try {
    await writeSecurityRules(directory);
    await writeSecurityRules(directory); // Idempotent prebuild.
    for (const name of ['ddd_backup_rules.xml', 'ddd_data_extraction_rules.xml', 'ddd_network_security_config.xml']) {
      assert.equal(await readFile(join(directory, 'app/src/main/res/xml', name), 'utf8'),
        await readFile(join(root, 'client/plugins/android-security', name), 'utf8'));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const appConfig = require('../client/app.config.js')({ config: {} });
  assert.ok(appConfig.plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === './plugins/withAndroidArtifactSecurity'));
  applySecurityPolicy(manifest, { allowInsecureHttp: true });
  assert.equal(manifest.manifest.application[0].$['android:networkSecurityConfig'], undefined);
  applySecurityPolicy(manifest, { allowInsecureHttp: false });
  assert.equal(manifest.manifest.application[0].$['android:networkSecurityConfig'], '@xml/ddd_network_security_config');
  manifest.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/custom_development_policy';
  applySecurityPolicy(manifest, { allowInsecureHttp: true });
  assert.equal(manifest.manifest.application[0].$['android:networkSecurityConfig'], '@xml/custom_development_policy');
});

test('security plugin adds only the missing base cropper activity and is idempotent', () => {
  const { applySecurityPolicy } = require('../client/plugins/withAndroidArtifactSecurity.js');
  for (const withActivities of [false, true]) {
    const manifest = manifestWithComponents();
    const application = manifest.manifest.application[0];
    if (!withActivities) delete application.activity;
    const original = structuredClone(manifest);
    assert.equal(applySecurityPolicy(manifest), manifest);
    assert.deepEqual(manifest.manifest.$, { ...original.manifest.$, 'xmlns:tools': toolsNamespace });
    assert.deepEqual(application.activity, [...(original.manifest.application[0].activity || []), { $: {
      'android:name': cropImageActivity, 'android:exported': 'false', 'tools:replace': 'android:exported',
    } }]);
    for (const kind of ['service', 'receiver', 'provider']) {
      assert.deepEqual(application[kind], original.manifest.application[0][kind]);
    }
    assert.equal(application.$['tools:replace'], 'android:allowBackup');
    const once = structuredClone(manifest);
    applySecurityPolicy(manifest);
    applySecurityPolicy(manifest);
    assert.deepEqual(manifest, once);
  }
});

test('security plugin preserves existing cropper attributes, children and unrelated merge directives', () => {
  const { applySecurityPolicy } = require('../client/plugins/withAndroidArtifactSecurity.js');
  for (const exported of [undefined, 'true', 'false']) {
    for (const node of [undefined, 'merge', 'mergeOnlyAttributes']) {
      const manifest = manifestWithComponents();
      manifest.manifest.$['xmlns:tools'] = toolsNamespace;
      const application = manifest.manifest.application[0];
      const activity = {
        $: {
          'android:name': cropImageActivity,
          'android:theme': '@style/ExistingCropperTheme', 'android:screenOrientation': 'portrait',
          'tools:replace': ' android:theme, android:exported,android:theme, android:exported ',
          'tools:remove': 'android:label', 'tools:strict': 'android:screenOrientation', 'tools:ignore': 'MissingClass',
          ...(exported === undefined ? {} : { 'android:exported': exported }),
          ...(node === undefined ? {} : { 'tools:node': node }),
        },
        'meta-data': [{ $: { 'android:name': 'existing.metadata', 'android:value': 'preserve' } }],
      };
      application.activity.splice(1, 0, activity);
      const original = structuredClone(manifest);
      applySecurityPolicy(manifest);
      assert.equal(application.activity[1], activity);
      assert.equal(application.activity.length, original.manifest.application[0].activity.length);
      assert.deepEqual(activity, { ...original.manifest.application[0].activity[1], $: {
        ...original.manifest.application[0].activity[1].$,
        'android:exported': 'false', 'tools:replace': 'android:theme,android:exported',
      } });
      assert.deepEqual(application.activity[0], original.manifest.application[0].activity[0]);
      assert.deepEqual(application.activity[2], original.manifest.application[0].activity[2]);
      for (const kind of ['service', 'receiver', 'provider']) {
        assert.deepEqual(application[kind], original.manifest.application[0][kind]);
      }
      assert.deepEqual(manifest.manifest.$, original.manifest.$);
      const once = structuredClone(manifest);
      applySecurityPolicy(manifest);
      assert.deepEqual(manifest, once);
    }
  }
});

test('security plugin appends exported to existing replacement tokens without discarding them', () => {
  const { applySecurityPolicy } = require('../client/plugins/withAndroidArtifactSecurity.js');
  const manifest = manifestWithComponents();
  const activity = { $: {
    'android:name': cropImageActivity, 'android:theme': '@style/ExistingCropperTheme',
    'tools:replace': ' android:theme, ,android:theme ',
  } };
  manifest.manifest.application[0].activity.push(activity);
  applySecurityPolicy(manifest);
  assert.equal(activity.$['tools:replace'], 'android:theme,android:exported');
});

test('security plugin rejects contradictory cropper merge directives without mutating the manifest', () => {
  const { applySecurityPolicy } = require('../client/plugins/withAndroidArtifactSecurity.js');
  const conflicts = [
    ...['remove', 'removeAll', 'replace', 'strict'].map((node) => ({ 'tools:node': node })),
    { 'tools:selector': 'some.other.library' },
    { 'tools:remove': 'android:label, android:exported' },
    { 'tools:strict': 'android:exported,android:theme' },
    { 'tools:remove': 'exported' },
    { 'tools:strict': 'exported' },
  ];
  for (const conflict of conflicts) {
    const manifest = manifestWithComponents();
    manifest.manifest.application[0].activity.push({ $: { 'android:name': cropImageActivity, ...conflict } });
    const original = structuredClone(manifest);
    assert.throws(() => applySecurityPolicy(manifest), /Cannot secure com\.canhub\.cropper\.CropImageActivity/);
    assert.deepEqual(manifest, original);
  }
});

test('security plugin rejects conflicting tools namespaces and duplicate cropper declarations', () => {
  const { applySecurityPolicy } = require('../client/plugins/withAndroidArtifactSecurity.js');
  for (const scope of ['manifest', 'application', 'activity']) {
    const manifest = manifestWithComponents();
    const application = manifest.manifest.application[0];
    const activity = { $: { 'android:name': cropImageActivity } };
    application.activity.push(activity);
    const element = { manifest: manifest.manifest, application, activity }[scope];
    element.$['xmlns:tools'] = 'https://invalid.example/tools';
    const original = structuredClone(manifest);
    assert.throws(() => applySecurityPolicy(manifest), /conflicting xmlns:tools/);
    assert.deepEqual(manifest, original);
  }
  const manifest = manifestWithComponents();
  manifest.manifest.application[0].activity.push(
    { $: { 'android:name': cropImageActivity, 'android:exported': 'false' } },
    { $: { 'android:name': cropImageActivity, 'android:exported': 'true' } },
  );
  const original = structuredClone(manifest);
  assert.throws(() => applySecurityPolicy(manifest), /duplicate com\.canhub\.cropper\.CropImageActivity/);
  assert.deepEqual(manifest, original);
});

for (const profile of ['preview', 'china-preview', 'global-preview', 'candidate']) {
  test(`security plugin hardens the manifest through the ${profile} app configuration`, () => {
    const result = spawnSync(process.execPath, ['-e', `
      (async () => {
        const config = require('./client/app.config.js')({ config: {} });
        const [pluginPath, options] = config.plugins.find((plugin) =>
          Array.isArray(plugin) && plugin[0] === './plugins/withAndroidArtifactSecurity');
        const configured = require('./client/' + pluginPath)(config, options);
        const manifest = ${JSON.stringify(manifestWithComponents())};
        const result = await configured.mods.android.manifest({ ...configured, modResults: manifest, modRequest: {} });
        console.log(JSON.stringify({ package: config.android.package, options, manifest: result.modResults }));
      })().catch((error) => { console.error(error); process.exitCode = 1; });
    `], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env,
        EAS_BUILD_PROFILE: profile,
        EXPO_PUBLIC_DEPLOYMENT_PROFILE: profile === 'global-preview' ? 'global' : 'china',
        EXPO_PUBLIC_BACKEND_BASE_URL: 'https://api.example.test',
        EXPO_PUBLIC_ANDROID_PACKAGE: '', EXPO_PUBLIC_ALLOW_INSECURE_HTTP: '1',
      },
    });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    const generated = JSON.parse(result.stdout);
    assert.equal(generated.package, profile === 'candidate' ? 'com.dietdigidose.app' : 'com.dietdigidose.app.preview');
    assert.equal(generated.options.allowInsecureHttp, false);
    const application = generated.manifest.manifest.application[0];
    assert.deepEqual(application.activity.find((activity) => activity.$['android:name'] === cropImageActivity), { $: {
      'android:name': cropImageActivity, 'android:exported': 'false', 'tools:replace': 'android:exported',
    } });
    assert.deepEqual(application.activity.slice(0, 2), manifestWithComponents().manifest.application[0].activity);
    assert.deepEqual(application.receiver, manifestWithComponents().manifest.application[0].receiver);
    assert.deepEqual(application.service, manifestWithComponents().manifest.application[0].service);
    assert.equal(generated.manifest.manifest.$['xmlns:tools'], toolsNamespace);
    assert.equal(application.$['android:networkSecurityConfig'], '@xml/ddd_network_security_config');
  });
}

test('release upload is downstream of the final artifact gate and cannot ignore failures', async () => {
  const workflow = await readFile(join(root, '.github/workflows/android-apk.yml'), 'utf8');
  const steps = ['Build signed release APK', 'Verify APK signature and package', 'Prepare artifact',
    'Gate final signed APK security before distribution', 'Upload APK'];
  const positions = steps.map((name) => workflow.indexOf(`- name: ${name}`));
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])));
  const gate = workflow.slice(positions[3], positions[4]);
  assert.match(gate, /working-directory: client\/artifact/);
  assert.match(gate, /set -euo pipefail/);
  assert.match(gate, /python3 ..\/..\/scripts\/check-apk-security.py/);
  assert.match(gate, /--apk "\$APK_PATH"/);
  assert.match(gate, /--source-sha "\$SIGNED_SOURCE_SHA"/);
  assert.match(gate, /--certificate-sha256 "\$EXPECTED_CERT_SHA256"/);
  assert.match(gate, /sha256sum --check SHA256SUMS.txt/);
  assert.doesNotMatch(gate, /continue-on-error|\|\| true|\n\s+if: /);
  assert.doesNotMatch(workflow.slice(positions[4]), /always\(\)|continue-on-error/);
  assert.match(workflow.slice(positions[4]), /path: client\/artifact\//);
});
