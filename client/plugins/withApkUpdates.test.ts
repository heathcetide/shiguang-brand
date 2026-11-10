const { parseDownloadOrigins, channelForProfile } = require('./withApkUpdates');

test('APK channel is bound to the native build profile and never inferred from package alone', () => {
  expect(channelForProfile('preview')).toBe('preview');
  expect(channelForProfile('global-preview')).toBe('preview');
  expect(channelForProfile('candidate')).toBe('candidate');
  expect(channelForProfile('production')).toBe('production');
  expect(channelForProfile('china-production')).toBe('production');
  expect(channelForProfile('simulator')).toBe('');
  expect(channelForProfile(undefined)).toBe('');
});

test('origin config defaults closed and refuses paths, credentials, fragments, queries and HTTP', () => {
  expect(parseDownloadOrigins()).toEqual([]);
  expect(parseDownloadOrigins('https://Downloads.example.com:443, https://downloads.example.com/')).toEqual(['https://downloads.example.com']);
  for (const origin of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?q=1', 'https://example.com#x']) {
    expect(() => parseDownloadOrigins(origin)).toThrow();
  }
});
