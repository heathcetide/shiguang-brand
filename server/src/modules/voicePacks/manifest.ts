import { createHash } from "node:crypto";
import type { VoicePackManifest, VoicePackResource, VoicePackRow } from "./types.js";

export const MAX_VOICE_PACK_RESOURCE_BYTES = 200 * 1024 * 1024;
export const MAX_VOICE_PACK_TOTAL_BYTES = 350 * 1024 * 1024;

function isHexSha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
export function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
export function parseVoicePackCatalog(raw = process.env.VOICE_PACK_CATALOG_JSON || "[]") {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((candidate): VoicePackManifest[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as VoicePackManifest;
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(String(item.voiceId || "")) || !/^\d+\.\d+\.\d+$/.test(String(item.version || ""))) return [];
    if (!item.name || item.language !== "zh-CN" || item.outputFormat !== "pcm-f32") return [];
    const distribution = item.distribution || "public";
    if (!["public", "internal-test"].includes(distribution)) return [];
    if (item.gender && !["male", "female", "neutral", "unspecified"].includes(item.gender)) return [];
    if (item.deviceRequirements && (!Array.isArray(item.deviceRequirements) || item.deviceRequirements.length > 12
      || item.deviceRequirements.some((value) => typeof value !== "string" || !value.trim() || value.length > 120))) return [];
    if (!Number.isInteger(item.sampleRate) || item.sampleRate < 8_000 || item.sampleRate > 48_000) return [];
    if (!item.license?.name || !safeHttpsUrl(item.license.url) || !item.license.speakerAuthorization || !item.license.modelNotice) return [];
    if (!Array.isArray(item.resources) || !item.resources.length || item.resources.length > 16 || item.resources.some((resource) =>
      !/^[a-z0-9][a-z0-9._/-]{0,199}$/i.test(resource.path) || resource.path.includes("..") || !safeHttpsUrl(resource.url)
      || !isHexSha256(resource.sha256) || !Number.isInteger(resource.bytes) || resource.bytes <= 0
      || resource.bytes > MAX_VOICE_PACK_RESOURCE_BYTES)) return [];
    if (item.resources.reduce((sum, resource) => sum + resource.bytes, 0) > MAX_VOICE_PACK_TOTAL_BYTES) return [];
    if (!item.model?.path || !item.model.vocabularyPath || !item.model.inputNames?.tokens || !item.model.inputNames.lengths) return [];
    const paths = new Set(item.resources.map((resource) => resource.path));
    if (paths.size !== item.resources.length || !paths.has(item.model.path) || !paths.has(item.model.vocabularyPath)) return [];
    const processor = item.model.textProcessor || { type: "character-v1" as const };
    if (processor.type === "token-map-v1" && (!processor.mappingPath || !paths.has(processor.mappingPath))) return [];
    if (!["character-v1", "token-map-v1"].includes(processor.type)) return [];
    if (!/^\d+\.\d+\.\d+$/.test(String(item.minimumAppVersion || "")) || !Number.isInteger(item.minimumMemoryMb) || item.minimumMemoryMb < 128) return [];
    if (item.previewUrl && !safeHttpsUrl(item.previewUrl)) return [];
    return [{ ...item, distribution, model: { ...item.model, textProcessor: processor }, revoked: Boolean(item.revoked) }];
  });
}
export function validateVoicePackManifest(value: unknown) { return parseVoicePackCatalog(JSON.stringify([value]))[0] || null; }
export function voicePackResourceFingerprint(manifest: VoicePackManifest) {
  return createHash("sha256").update(JSON.stringify(manifest.resources
    .map(({ path, url, sha256, bytes }: VoicePackResource) => ({ path, url, sha256: sha256.toLowerCase(), bytes }))
    .sort((left, right) => left.path.localeCompare(right.path)))).digest("hex");
}
export function parseVoicePackRow(row: VoicePackRow) {
  const manifest = (typeof row.manifest_json === "string" ? JSON.parse(row.manifest_json) : row.manifest_json) as VoicePackManifest;
  return { ...manifest, distribution: manifest.distribution || "public",
    model: { ...manifest.model, textProcessor: manifest.model.textProcessor || { type: "character-v1" } } } as VoicePackManifest;
}

export function internalTestVoicePacksEnabled(environment = process.env) {
  const deployment = environment.DEPLOYMENT_ENV || (environment.NODE_ENV === "production" ? "production" : "development");
  return ["development", "test", "staging"].includes(deployment) && environment.VOICE_PACK_ALLOW_INTERNAL_TEST === "1";
}
function semverParts(value: string) { return /^\d+\.\d+\.\d+/.test(value) ? value.split(".").slice(0, 3).map(Number) : [0, 0, 0]; }
export function appVersionAtLeast(actual: string, minimum: string) {
  const left = semverParts(actual); const right = semverParts(minimum);
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index]! > right[index]!;
  return true;
}
