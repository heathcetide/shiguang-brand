export type AppUpdateChannel = 'preview' | 'candidate' | 'production';

export interface AppUpdateRelease {
  schemaVersion: 1;
  platform: 'android';
  applicationId: string;
  channel: AppUpdateChannel;
  version: string;
  snapshot: string;
  buildNumber: number;
  url: string;
  sizeBytes: number;
  sha256: string;
  releaseNotes: string;
  publishedAt: string;
}

export interface AppUpdateManifest {
  schemaVersion: 1;
  releases: AppUpdateRelease[];
}

export function computeBuildNumberFromSnapshot(snapshot: string): number | null {
  if (!/^\d{2}w(?:0[1-9]|[1-4]\d|5[0-3])[a-z]$/.test(snapshot)) return null;
  const revision = snapshot.at(-1)!.charCodeAt(0) - 96;
  return Number(`${snapshot.slice(0, 2)}${snapshot.slice(3, 5)}${String(revision).padStart(2, "0")}`);
}
