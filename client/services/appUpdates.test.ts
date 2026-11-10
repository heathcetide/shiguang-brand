import { appUpdateReleaseSchema } from '@dietdigidose/contracts';
import {
  installedApp, matchingUpdate, checkAppUpdate, downloadAllowed, sameUpdate,
  shouldAutoCheck, AUTO_CHECK_INTERVAL, type InstalledApp,
} from './appUpdates';
import { requestJson } from './api/client';

const mockIdentity = jest.fn();
jest.mock('expo', () => ({ requireOptionalNativeModule: () => ({ getIdentity: () => mockIdentity() }) }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('@/utils/config', () => ({ API_BASE: 'https://api.example.com' }));
jest.mock('./api/client', () => ({ publicFetch: jest.fn(), requestJson: jest.fn() }));

const installed: InstalledApp = {
  applicationId: 'com.dietdigidose.app.preview', channel: 'preview', buildNumber: 263801,
  version: '1.0.6', snapshot: '26w38a', downloadOrigins: ['https://downloads.example.com'],
};
const release = appUpdateReleaseSchema.parse({
  schemaVersion: 1, platform: 'android', applicationId: installed.applicationId, channel: 'preview',
  version: '1.0.6', snapshot: '26w41a', buildNumber: 264101, url: 'https://downloads.example.com/app.apk',
  sizeBytes: 12345678, sha256: 'a'.repeat(64), releaseNotes: '修复更新问题', publishedAt: '2026-10-07T00:00:00.000Z',
});

beforeEach(() => jest.clearAllMocks());

test('installed identity comes only from the native package; absent or unclassified packages are unsupported', () => {
  mockIdentity.mockReturnValue(installed);
  expect(installedApp()).toEqual(installed);
  mockIdentity.mockReturnValue({ ...installed, channel: '' });
  expect(installedApp()).toBeNull();
  mockIdentity.mockImplementation(() => { throw new Error('no native module'); });
  expect(installedApp()).toBeNull();
});

test('version checks reject mixed channels/packages and ignore equal or lower native build numbers', () => {
  expect(matchingUpdate(release, installed)).toEqual(release);
  expect(matchingUpdate(null, installed)).toBeNull();
  expect(matchingUpdate(release, { ...installed, buildNumber: release.buildNumber })).toBeNull();
  expect(matchingUpdate(release, { ...installed, buildNumber: release.buildNumber + 1 })).toBeNull();
  expect(() => matchingUpdate(release, { ...installed, channel: 'candidate' })).toThrow('不匹配');
  expect(() => matchingUpdate(release, { ...installed, applicationId: 'com.dietdigidose.app' })).toThrow('不匹配');
});

test('checks send only native identity with no cached response; failures are not treated as no update', async () => {
  jest.mocked(requestJson).mockResolvedValueOnce({ update: release });
  await expect(checkAppUpdate(installed)).resolves.toEqual(release);
  expect(requestJson).toHaveBeenCalledWith(expect.any(Function),
    `/api/v1/app-updates?platform=android&applicationId=${installed.applicationId}&channel=preview&buildNumber=263801`,
    expect.objectContaining({ cache: 'no-store', timeoutMs: 15000 }), expect.objectContaining({ parse: expect.any(Function) }));
  const schema = jest.mocked(requestJson).mock.calls[0][3]!;
  expect(() => schema.parse({ update: { ...release, sha256: 'wrong' } })).toThrow();
  expect(() => schema.parse({})).toThrow();
  jest.mocked(requestJson).mockRejectedValueOnce(new Error('503'));
  await expect(checkAppUpdate(installed)).rejects.toThrow('503');
});

test('download origins must be explicitly compiled into the installed package', () => {
  expect(downloadAllowed(release, installed)).toBe(true);
  expect(downloadAllowed(release, { ...installed, downloadOrigins: ['HTTPS://DOWNLOADS.EXAMPLE.COM'] })).toBe(true);
  expect(downloadAllowed(release, { ...installed, downloadOrigins: [] })).toBe(false);
  for (const url of ['http://downloads.example.com/app.apk', 'https://downloads.example.com.evil/app.apk', 'https://evil.example.com/app.apk', 'https://user:pass@downloads.example.com/app.apk', 'https://downloads.example.com/app.apk#x']) {
    expect(downloadAllowed({ ...release, url }, installed)).toBe(false);
  }
});

test('withdrawal or replacement invalidates a downloaded package before installation', () => {
  expect(sameUpdate(release, { ...release })).toBe(true);
  expect(sameUpdate(release, null)).toBe(false);
  for (const changed of [{ buildNumber: 264102 }, { sha256: 'b'.repeat(64) }, { url: 'https://downloads.example.com/other.apk' }, { sizeBytes: 1 }, { channel: 'production' as const }]) {
    expect(sameUpdate(release, { ...release, ...changed })).toBe(false);
  }
});

test('automatic checks and postponement last 24 hours and recover from corrupt storage/clock changes', () => {
  const now = 1_800_000_000_000;
  expect(shouldAutoCheck(null, now)).toBe(true);
  expect(shouldAutoCheck('broken', now)).toBe(true);
  expect(shouldAutoCheck(JSON.stringify({ checkedAt: now - 1 }), now)).toBe(false);
  expect(shouldAutoCheck(JSON.stringify({ checkedAt: now - AUTO_CHECK_INTERVAL }), now)).toBe(true);
  expect(shouldAutoCheck(JSON.stringify({ checkedAt: now - AUTO_CHECK_INTERVAL, postponedUntil: now + 1 }), now)).toBe(false);
  expect(shouldAutoCheck(JSON.stringify({ checkedAt: now + AUTO_CHECK_INTERVAL, postponedUntil: now + 2 * AUTO_CHECK_INTERVAL }), now)).toBe(true);
});
