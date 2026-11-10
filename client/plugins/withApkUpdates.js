/* global module, require */
const { URL } = require('node:url');

function parseDownloadOrigins(value = '') {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const url = new URL(item);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('EXPO_PUBLIC_APK_DOWNLOAD_ORIGINS must contain comma-separated HTTPS origins, without paths or credentials');
    }
    return url.origin;
  }))];
}

function channelForProfile(profile) {
  if (['preview', 'china-preview', 'global-preview'].includes(profile)) return 'preview';
  if (profile === 'candidate') return 'candidate';
  if (['production', 'china-production', 'global-production'].includes(profile)) return 'production';
  return '';
}

function withApkUpdates(config, { channel, origins, snapshot }) {
  const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');
  return withAndroidManifest(config, (result) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(result.modResults);
    for (const [name, value] of Object.entries({ channel, origins: origins.join(','), snapshot })) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, `com.dietdigidose.updates.${name}`, value);
    }
    return result;
  });
}

module.exports = withApkUpdates;
module.exports.parseDownloadOrigins = parseDownloadOrigins;
module.exports.channelForProfile = channelForProfile;
