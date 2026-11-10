import { z } from "zod";

export const APP_UPDATE_MANIFEST_MAX_BYTES = 1024 * 1024;
export const appUpdateChannelSchema = z.enum(["preview", "candidate", "production"]);
export const appUpdateApplicationIdSchema = z.string().max(200).regex(/^[A-Za-z]\w*(?:\.[A-Za-z]\w*)+$/);
export const appUpdateHttpsUrlSchema = z.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash;
}, "APK URL must use HTTPS without credentials or a fragment");

export const appUpdateReleaseSchema = z.object({
  schemaVersion: z.literal(1),
  platform: z.literal("android"),
  applicationId: appUpdateApplicationIdSchema,
  channel: appUpdateChannelSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  snapshot: z.string().regex(/^\d{2}w(?:0[1-9]|[1-4]\d|5[0-3])[a-z]$/),
  buildNumber: z.number().int().positive().max(2_100_000_000),
  url: appUpdateHttpsUrlSchema,
  sizeBytes: z.number().int().positive().max(512 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  releaseNotes: z.string().trim().min(1).max(4000),
  publishedAt: z.string().datetime(),
}).strict().superRefine((release, context) => {
  const revision = release.snapshot.at(-1)!.charCodeAt(0) - 96;
  const expected = Number(`${release.snapshot.slice(0, 2)}${release.snapshot.slice(3, 5)}${String(revision).padStart(2, "0")}`);
  if (release.buildNumber !== expected) context.addIssue({ code: "custom", path: ["buildNumber"], message: "Build number must match the weekly snapshot" });
});

export const appUpdateManifestSchema = z.object({
  schemaVersion: z.literal(1),
  releases: z.array(appUpdateReleaseSchema).max(20),
}).strict().superRefine((manifest, context) => {
  const identities = new Set<string>();
  for (const release of manifest.releases) {
    const identity = `${release.applicationId}:${release.channel}`;
    if (identities.has(identity)) context.addIssue({ code: "custom", path: ["releases"], message: "Only one release per application and channel is allowed" });
    identities.add(identity);
  }
});

export const appUpdateQuerySchema = z.object({
  platform: z.literal("android"),
  applicationId: appUpdateApplicationIdSchema,
  channel: appUpdateChannelSchema,
  buildNumber: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(z.number().int().max(2_100_000_000)),
}).strict();

export function computeBuildNumberFromSnapshot(snapshot: string): number | null {
  if (!/^\d{2}w(?:0[1-9]|[1-4]\d|5[0-3])[a-z]$/.test(snapshot)) return null;
  const revision = snapshot.at(-1)!.charCodeAt(0) - 96;
  return Number(`${snapshot.slice(0, 2)}${snapshot.slice(3, 5)}${String(revision).padStart(2, "0")}`);
}

export type AppUpdateRelease = z.infer<typeof appUpdateReleaseSchema>;
export type AppUpdateChannel = z.infer<typeof appUpdateChannelSchema>;
export type AppUpdateManifest = z.infer<typeof appUpdateManifestSchema>;
