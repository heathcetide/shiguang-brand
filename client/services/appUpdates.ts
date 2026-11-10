import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { z } from 'zod';
import { appUpdateApplicationIdSchema, appUpdateChannelSchema, appUpdateReleaseSchema, type AppUpdateRelease } from '@dietdigidose/contracts';
import { API_BASE } from '@/utils/config';
import { publicFetch, requestJson } from '@/services/api/client';

const installedAppSchema = z.object({
  applicationId: appUpdateApplicationIdSchema,
  buildNumber: z.number().int().positive(),
  version: z.string(),
  channel: appUpdateChannelSchema,
  snapshot: z.string(),
  downloadOrigins: z.array(z.string().url()),
});
export type InstalledApp = z.infer<typeof installedAppSchema>;
export type DownloadProgress = { requestId: string; received: number; total: number };
type ApkUpdatesNative = {
  getIdentity: () => unknown;
  addListener: (event: 'downloadProgress', listener: (event: DownloadProgress) => void) => { remove: () => void };
  download: (requestId: string, url: string, size: number, sha256: string, buildNumber: number) => Promise<void>;
  cancelDownload: (requestId: string) => void;
  install: (size: number, sha256: string, buildNumber: number) => Promise<'permissionRequired' | 'opened'>;
};

export const apkUpdates = Platform.OS === 'android'
  ? requireOptionalNativeModule<ApkUpdatesNative>('ApkUpdates') : null;

export function installedApp(): InstalledApp | null {
  try {
    const parsed = installedAppSchema.safeParse(apkUpdates?.getIdentity());
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export function matchingUpdate(update: AppUpdateRelease | null, installed: InstalledApp): AppUpdateRelease | null {
  if (!update) return null;
  if (update.platform !== 'android' || update.applicationId !== installed.applicationId || update.channel !== installed.channel) {
    throw new Error('更新清单与当前应用不匹配，请稍后重试');
  }
  return update.buildNumber > installed.buildNumber ? update : null;
}

export async function checkAppUpdate(installed: InstalledApp, signal?: AbortSignal) {
  const endpoint = new URL(API_BASE);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('此安装包尚未配置安全的更新服务');
  }
  const query = new URLSearchParams({
    platform: 'android', applicationId: installed.applicationId,
    channel: installed.channel, buildNumber: String(installed.buildNumber),
  });
  const result = await requestJson(publicFetch, `/api/v1/app-updates?${query}`, {
    cache: 'no-store', signal, timeoutMs: 15_000,
  }, z.object({ update: appUpdateReleaseSchema.nullable() }).strict());
  return matchingUpdate(result.update, installed);
}

export function downloadAllowed(update: AppUpdateRelease, installed: InstalledApp) {
  const url = new URL(update.url);
  const origin = url.origin.toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash
    && installed.downloadOrigins.some((allowed) => allowed.trim().toLowerCase() === origin);
}

export function sameUpdate(first: AppUpdateRelease, second: AppUpdateRelease | null) {
  return second !== null && first.applicationId === second.applicationId && first.channel === second.channel
    && first.buildNumber === second.buildNumber && first.sha256 === second.sha256
    && first.url === second.url && first.sizeBytes === second.sizeBytes;
}

export const AUTO_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
export function shouldAutoCheck(record: string | null, now: number) {
  try {
    const data: unknown = JSON.parse(record || '{}');
    const parsed = z.object({ checkedAt: z.number().finite().nonnegative(), postponedUntil: z.number().finite().nonnegative().optional() }).safeParse(data);
    if (!parsed.success) return true;
    // Clock corrections must not silence update checks indefinitely.
    return (parsed.data.checkedAt > now || now - parsed.data.checkedAt >= AUTO_CHECK_INTERVAL)
      && (!parsed.data.postponedUntil || parsed.data.postponedUntil <= now || parsed.data.postponedUntil > now + AUTO_CHECK_INTERVAL);
  } catch { return true; }
}
