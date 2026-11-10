import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getProviderProfile } from "../providers/profiles.js";
import { getSupabaseClient, getSupabaseServiceRoleKey } from "../storage/database/supabase-client.js";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export class MediaStorageUnavailableError extends Error {}
export class InvalidMediaError extends Error {}

export type StoredMediaReference =
  | { backend: "local"; path: string }
  | { backend: "supabase"; origin: string; bucket: string; objectPath: string };

type MediaUploadOptions = { deterministicKey?: string; overwrite?: boolean };

export async function uploadImageDataUrl(
  dataUrl: string,
  userId: number,
  scope: "community",
  options: MediaUploadOptions = {},
) {
  const parsed = parseImageDataUrl(dataUrl);
  if (options.deterministicKey && !/^[a-f0-9]{64}$/.test(options.deterministicKey)) {
    throw new InvalidMediaError("媒体对象摘要无效");
  }
  const remoteStorage = getProviderProfile().providers.storage === "supabase-storage";
  if (!remoteStorage) {
    return uploadToLocalMedia(parsed, userId, scope, options);
  }
  const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim();
  if (!bucket || !getSupabaseServiceRoleKey()) {
    throw new MediaStorageUnavailableError("媒体对象存储配置不可用");
  }
  const client = getSupabaseClient();
  if (!client) throw new MediaStorageUnavailableError("媒体对象存储尚未配置");

  const objectPath = options.deterministicKey
    ? `${scope}/${userId}/migration/${options.deterministicKey}.${parsed.extension}`
    : `${scope}/${userId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${parsed.extension}`;
  const { error } = await client.storage.from(bucket).upload(objectPath, parsed.buffer, {
    contentType: parsed.mimeType,
    cacheControl: "31536000",
    upsert: Boolean(options.overwrite),
  });
  if (error) throw new Error(`媒体上传失败: ${error.message}`);
  const { data } = client.storage.from(bucket).getPublicUrl(objectPath);
  if (!data.publicUrl) throw new Error("媒体对象存储未返回公开 URL");
  return { url: data.publicUrl, objectPath, bytes: parsed.buffer.byteLength, mimeType: parsed.mimeType };
}

const getPublicMediaRoot = () => path.resolve(process.env.MEDIA_LOCAL_ROOT || path.join(process.cwd(), "public"));

async function uploadToLocalMedia(
  parsed: ReturnType<typeof parseImageDataUrl>,
  userId: number,
  scope: "community",
  options: MediaUploadOptions,
) {
  const directory = options.deterministicKey ? "migration" : new Date().toISOString().slice(0, 10);
  const fileName = `${options.deterministicKey || randomUUID()}.${parsed.extension}`;
  const objectPath = `uploads/${scope}/${userId}/${directory}/${fileName}`;
  const publicMediaRoot = getPublicMediaRoot();
  const destination = path.resolve(publicMediaRoot, objectPath);
  if (!destination.startsWith(`${publicMediaRoot}${path.sep}`)) {
    throw new InvalidMediaError("媒体保存路径无效");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, parsed.buffer, { flag: options.overwrite ? "w" : "wx" });
  return {
    url: `/media/${objectPath}`,
    objectPath,
    bytes: parsed.buffer.byteLength,
    mimeType: parsed.mimeType,
  };
}

function getPublicObjectPrefix() {
  const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim();
  const baseUrl = process.env.SUPABASE_URL?.trim();
  if (!bucket || !baseUrl) return null;
  return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(bucket)}/`;
}

function getLocalMediaPathForUser(url: string, userId: number, scope: "community") {
  const localPrefix = `/media/uploads/${scope}/${userId}/`;
  if (!url.startsWith(localPrefix)) return null;
  try {
    const localOrigin = "http://local-media.invalid";
    const parsed = new URL(url, localOrigin);
    return parsed.origin === localOrigin && parsed.pathname.startsWith(localPrefix) ? parsed.pathname : null;
  } catch {
    return null;
  }
}

function getPublicObjectPathForUser(url: string, userId: number, scope: "community") {
  const prefix = getPublicObjectPrefix();
  if (!prefix) return null;
  try {
    const publicPrefix = new URL(prefix);
    const candidate = new URL(url);
    const userPathPrefix = `${publicPrefix.pathname}${scope}/${userId}/`;
    if (candidate.origin !== publicPrefix.origin || !candidate.pathname.startsWith(userPathPrefix)) return null;
    return decodeURIComponent(candidate.pathname.slice(publicPrefix.pathname.length));
  } catch {
    return null;
  }
}

function getSupabaseReferenceForUser(url: string, userId: number, scope: "community"): StoredMediaReference | null {
  try {
    const candidate = new URL(url);
    if (candidate.protocol !== "https:") return null;
    const marker = "/storage/v1/object/public/";
    const markerIndex = candidate.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const configuredOrigin = process.env.SUPABASE_URL?.trim();
    if (configuredOrigin && candidate.origin !== new URL(configuredOrigin).origin) return null;
    const remainder = candidate.pathname.slice(markerIndex + marker.length);
    const slash = remainder.indexOf("/");
    if (slash <= 0) return null;
    const bucket = decodeURIComponent(remainder.slice(0, slash));
    const objectPath = decodeURIComponent(remainder.slice(slash + 1));
    if (!bucket || !objectPath.startsWith(`${scope}/${userId}/`) || objectPath.includes("..")) return null;
    return { backend: "supabase", origin: candidate.origin, bucket, objectPath };
  } catch {
    return null;
  }
}

export function describeStoredMediaUrls(userId: number, urls: Array<string | null | undefined>): StoredMediaReference[] {
  const references = urls.flatMap((url): StoredMediaReference[] => {
    if (typeof url !== "string") return [];
    const localPath = getLocalMediaPathForUser(url, userId, "community");
    if (localPath) return [{ backend: "local", path: localPath }];
    const remote = getSupabaseReferenceForUser(url, userId, "community");
    return remote ? [remote] : [];
  });
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = JSON.stringify(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isStoredMediaUrlForUser(url: string, userId: number, scope: "community" = "community") {
  return Boolean(
    getLocalMediaPathForUser(url, userId, scope)
    || getPublicObjectPathForUser(url, userId, scope),
  );
}

export async function deleteStoredMediaUrls(userId: number, urls: Array<string | null | undefined>) {
  return deleteStoredMediaReferences(describeStoredMediaUrls(userId, urls));
}

export async function deleteStoredMediaReferences(references: StoredMediaReference[]) {
  const localUrls = references.flatMap((reference) => reference.backend === "local" ? [reference.path] : []);
  const publicMediaRoot = getPublicMediaRoot();
  await Promise.all(localUrls.map(async (url) => {
    const relativePath = url.slice("/media/".length);
    const destination = path.resolve(publicMediaRoot, relativePath);
    if (destination.startsWith(`${publicMediaRoot}${path.sep}`)) await rm(destination, { force: true });
  }));
  const remoteReferences = references.filter((reference): reference is Extract<StoredMediaReference, { backend: "supabase" }> => reference.backend === "supabase");
  if (!remoteReferences.length) return;
  const configuredBucket = process.env.SUPABASE_MEDIA_BUCKET?.trim();
  const configuredUrl = process.env.SUPABASE_URL?.trim();
  const configuredOrigin = configuredUrl ? new URL(configuredUrl).origin : null;
  if (!configuredBucket || !configuredOrigin || !getSupabaseServiceRoleKey()) {
    throw new MediaStorageUnavailableError("媒体对象存储配置不可用，任务将保留等待重试");
  }
  if (remoteReferences.some((reference) => reference.bucket !== configuredBucket || reference.origin !== configuredOrigin)) {
    throw new MediaStorageUnavailableError("媒体对象存储定位与当前配置不一致，任务将保留等待重试");
  }
  const client = getSupabaseClient();
  if (!client) throw new MediaStorageUnavailableError("媒体对象存储尚未配置");
  const objectPaths = [...new Set(remoteReferences.map((reference) => reference.objectPath))];
  const { error } = await client.storage.from(configuredBucket).remove(objectPaths);
  if (error) throw new Error(`媒体删除失败: ${error.message}`);
}

export function parseImageDataUrl(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new InvalidMediaError("仅支持 JPEG、PNG、WebP 或 GIF 图片");
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new InvalidMediaError("图片不能为空且不得超过 4 MB");
  }
  if (!matchesMagicBytes(buffer, mimeType)) throw new InvalidMediaError("图片内容与声明格式不一致");
  return { buffer, mimeType, extension: MIME_EXTENSIONS[mimeType] };
}

function matchesMagicBytes(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (mimeType === "image/gif") return buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6));
  return false;
}
