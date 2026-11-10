/* global module, require, __dirname */
const fs = require('node:fs/promises');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

const CROP_IMAGE_ACTIVITY = 'com.canhub.cropper.CropImageActivity';
const TOOLS_NAMESPACE = 'http://schemas.android.com/tools';
const mergeTokens = (value = '') => value.split(',').map((token) => token.trim()).filter(Boolean);

function restrictCropImageActivity(manifest, application) {
  const activities = application.activity || [];
  const matches = activities.filter((activity) => activity.$?.['android:name'] === CROP_IMAGE_ACTIVITY);
  if (matches.length > 1) {
    throw new Error(`Cannot secure duplicate ${CROP_IMAGE_ACTIVITY} declarations`);
  }
  const activity = matches[0] || { $: { 'android:name': CROP_IMAGE_ACTIVITY } };
  const attributes = activity.$;
  for (const element of [manifest.manifest, application, activity]) {
    const namespace = element.$?.['xmlns:tools'];
    if (namespace !== undefined && namespace !== TOOLS_NAMESPACE) {
      throw new Error(`Cannot secure ${CROP_IMAGE_ACTIVITY}: conflicting xmlns:tools`);
    }
  }
  const nodeDirective = attributes['tools:node'];
  if (nodeDirective !== undefined && !['merge', 'mergeOnlyAttributes'].includes(nodeDirective)) {
    throw new Error(`Cannot secure ${CROP_IMAGE_ACTIVITY}: conflicting tools:node=${nodeDirective}`);
  }
  if (attributes['tools:selector'] !== undefined) {
    throw new Error(`Cannot secure ${CROP_IMAGE_ACTIVITY}: tools:selector scopes the export override`);
  }
  for (const directive of ['tools:remove', 'tools:strict']) {
    if (mergeTokens(attributes[directive]).some((token) => ['exported', 'android:exported'].includes(token))) {
      throw new Error(`Cannot secure ${CROP_IMAGE_ACTIVITY}: conflicting ${directive} for android:exported`);
    }
  }

  // Override only the base library activity. Expo image-picker launches its own subclass.
  manifest.manifest.$ ||= {};
  manifest.manifest.$['xmlns:tools'] = TOOLS_NAMESPACE;
  attributes['android:exported'] = 'false';
  attributes['tools:replace'] = [...new Set([...mergeTokens(attributes['tools:replace']), 'android:exported'])].join(',');
  if (matches.length === 0) {
    application.activity = [...activities, activity];
  }
}

function applySecurityPolicy(manifest, { allowInsecureHttp = false } = {}) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  restrictCropImageActivity(manifest, application);
  application.$['android:allowBackup'] = 'false';
  application.$['android:fullBackupContent'] = '@xml/ddd_backup_rules';
  application.$['android:dataExtractionRules'] = '@xml/ddd_data_extraction_rules';
  if (!allowInsecureHttp) {
    application.$['android:networkSecurityConfig'] = '@xml/ddd_network_security_config';
  } else if (application.$['android:networkSecurityConfig'] === '@xml/ddd_network_security_config') {
    delete application.$['android:networkSecurityConfig'];
  }
  return manifest;
}

async function writeSecurityRules(platformProjectRoot) {
  const destination = path.join(platformProjectRoot, 'app/src/main/res/xml');
  await fs.mkdir(destination, { recursive: true });
  for (const filename of ['ddd_backup_rules.xml', 'ddd_data_extraction_rules.xml', 'ddd_network_security_config.xml']) {
    await fs.copyFile(path.join(__dirname, 'android-security', filename), path.join(destination, filename));
  }
}

module.exports = function withAndroidArtifactSecurity(config, options = {}) {
  config = withAndroidManifest(config, (result) => {
    applySecurityPolicy(result.modResults, options);
    return result;
  });
  return withDangerousMod(config, ['android', async (result) => {
    await writeSecurityRules(result.modRequest.platformProjectRoot);
    return result;
  }]);
};
module.exports.applySecurityPolicy = applySecurityPolicy;
module.exports.writeSecurityRules = writeSecurityRules;
