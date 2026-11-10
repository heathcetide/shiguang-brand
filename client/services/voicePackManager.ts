import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/src/legacy";
import * as Network from "expo-network";
import * as Speech from "expo-speech";
import { Base64 } from "js-base64";
import { Platform } from "react-native";

import type { ApiFetch } from "@/services/api/client";
import { voicePackApi, type VoicePackManifest } from "@/services/api/ai";
import {
  isVoicePackSelected,
  voicePreferenceStorageKey,
  VOICE_PREFERENCE_STORAGE_PREFIX,
} from "@/services/voicePreferenceScope";
import { beginVoiceOutput } from "@/services/voiceCaptureGate";
import { KeyedSerialQueue } from "@/services/voiceOutputQueue";
import { ScopedTaskCoordinator } from "@/services/scopedTaskCoordinator";
import { loadVoiceOnnxRuntime } from "@/services/voiceOnnxRuntime";
import {
  MAX_VOICE_PACK_RESOURCE_BYTES,
  MAX_VOICE_PACK_TOTAL_BYTES,
  replaceVoicePackDirectory,
  tokenizeVoiceText,
  voiceBenchmarkPassed,
  voicePlaybackFinished,
} from "@/services/voicePackPolicy";

const PACK_ROOT = Platform.OS === "web" || !FileSystem.documentDirectory
  ? null
  : `${FileSystem.documentDirectory}voice-packs-v1/`;
const AUDIO_CACHE_ROOT = Platform.OS === "web" || !FileSystem.cacheDirectory
  ? null
  : `${FileSystem.cacheDirectory}voice-output-v1/`;
const LEGACY_STATE_KEY = "voice-pack-state-v1";
const DEVICE_STATE_KEY = "voice-pack-device-state-v2";
const CACHE_INDEX_KEY = "voice-audio-cache-index-v1";
const MAX_AUDIO_CACHE_BYTES = 80 * 1024 * 1024;
// Source-less cache entries cannot safely distinguish local WAV from server audio.
const VOICE_CACHE_SCHEMA = 3;

export type VoiceSource = "local" | "server" | "system";
export type VoicePreference = "automatic" | "system-only";
export type VoicePackState = {
  installed: VoicePackManifest | null;
  installedPacks: VoicePackManifest[];
  selectedVoiceId: string | null;
  selectedVersion: string | null;
  preference: VoicePreference;
  preferenceVersion: number;
  benchmark: null | { modelLoadMs: number; firstAudioMs: number; realtimeFactor: number; peakMemoryMb: number | null; passed: boolean; measuredAt: string };
  pausedDownload: null | { manifest: VoicePackManifest; resourcePath: string; completedBytes: number; resumeData: string };
};
type DeviceVoicePackState = {
  installedPacks: VoicePackManifest[];
  benchmarks: Record<string, NonNullable<VoicePackState["benchmark"]>>;
  pausedDownload: VoicePackState["pausedDownload"];
};
type UserVoicePreference = {
  selectedVoiceId: string | null;
  selectedVersion: string | null;
  preference: VoicePreference;
  version: number;
};
type AudioCacheRow = { uri: string; bytes: number; accessedAt: number; expiresAt?: number; sensitive: boolean; userScope: string; voiceKey?: string };

const defaultDeviceState: DeviceVoicePackState = { installedPacks: [], benchmarks: {}, pausedDownload: null };
const defaultPreference: UserVoicePreference = { selectedVoiceId: null, selectedVersion: null, preference: "automatic", version: 0 };
let activeDownload: FileSystem.DownloadResumable | null = null;
let activeDownloadContext: VoicePackState["pausedDownload"] = null;
let activeSound: Audio.Sound | null = null;
let playbackGeneration = 0;
let audioCacheTempSequence = 0;
const audioCacheTasks = new ScopedTaskCoordinator();
let localSession: null | { key: string; session: any; vocabulary: Record<string, number>;
  tokenMap: Record<string, string[]>; manifest: VoicePackManifest } = null;

async function ensureDirectory(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
}

function requireNativeRoot(root: string | null) {
  if (!root) throw new Error("当前平台不支持本地音色文件存储");
  return root;
}

function preferenceKey(userId?: number) {
  return voicePreferenceStorageKey(userId);
}

async function getDeviceState(): Promise<DeviceVoicePackState> {
  try {
    const stored = JSON.parse(await AsyncStorage.getItem(DEVICE_STATE_KEY) || "null") as DeviceVoicePackState | null;
    if (stored) return { ...defaultDeviceState, ...stored };
    const legacy = JSON.parse(await AsyncStorage.getItem(LEGACY_STATE_KEY) || "null") as VoicePackState | null;
    const migrated = { ...defaultDeviceState, installedPacks: legacy?.installed ? [legacy.installed] : [] };
    await AsyncStorage.setItem(DEVICE_STATE_KEY, JSON.stringify(migrated));
    await AsyncStorage.removeItem(LEGACY_STATE_KEY);
    return migrated;
  } catch {
    return defaultDeviceState;
  }
}

async function saveDeviceState(state: DeviceVoicePackState) {
  await AsyncStorage.setItem(DEVICE_STATE_KEY, JSON.stringify(state));
  return state;
}

async function getUserPreference(userId?: number): Promise<UserVoicePreference> {
  try {
    const stored = JSON.parse(await AsyncStorage.getItem(preferenceKey(userId)) || "null") as UserVoicePreference | null;
    return stored ? { ...defaultPreference, ...stored } : defaultPreference;
  } catch {
    return defaultPreference;
  }
}

async function saveUserPreference(userId: number | undefined, preference: UserVoicePreference) {
  await AsyncStorage.setItem(preferenceKey(userId), JSON.stringify(preference));
  return preference;
}

export async function getVoicePackState(userId?: number): Promise<VoicePackState> {
  const [device, preference] = await Promise.all([getDeviceState(), getUserPreference(userId)]);
  const installed = device.installedPacks.find((manifest) => manifest.voiceId === preference.selectedVoiceId && manifest.version === preference.selectedVersion) || null;
  return {
    installed,
    installedPacks: device.installedPacks,
    selectedVoiceId: preference.selectedVoiceId,
    selectedVersion: preference.selectedVersion,
    preference: preference.preference,
    preferenceVersion: preference.version,
    benchmark: installed ? device.benchmarks[`${installed.voiceId}@${installed.version}`] || null : null,
    pausedDownload: device.pausedDownload,
  };
}

export async function applyVoicePreference(userId: number | undefined, input: UserVoicePreference) {
  await saveUserPreference(userId, input);
  return getVoicePackState(userId);
}

export async function setVoicePreference(preference: VoicePreference, userId?: number) {
  const current = await getUserPreference(userId);
  await saveUserPreference(userId, { ...current, preference });
  return getVoicePackState(userId);
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256File(uri: string) {
  const bytes = await new File(uri).bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return bytesToHex(new Uint8Array(digest));
}

function safeResourcePath(path: string) {
  if (!/^(?!_)\w[\w./-]{0,199}$/i.test(path) || path.includes("..")) throw new Error("音色包资源路径无效");
  return path;
}

export async function installVoicePack(
  manifest: VoicePackManifest,
  options: { allowCellular?: boolean; onProgress?: (progress: number) => void; userId?: number } = {},
) {
  if (Platform.OS === "web") throw new Error("Web 暂不支持本地 ONNX 音色包，请使用云端或系统语音");
  if (!manifest.resources.length || manifest.resources.length > 16
    || manifest.resources.some((resource) => resource.bytes <= 0 || resource.bytes > MAX_VOICE_PACK_RESOURCE_BYTES)
    || manifest.resources.reduce((sum, resource) => sum + resource.bytes, 0) > MAX_VOICE_PACK_TOTAL_BYTES) {
    throw new Error("音色包资源数量或大小超出安全限制");
  }
  const packRoot = requireNativeRoot(PACK_ROOT);
  const network = await Network.getNetworkStateAsync();
  if (network.isConnected === false || network.isInternetReachable === false) throw new Error("当前没有可用网络");
  if (!options.allowCellular && network.type === Network.NetworkStateType.CELLULAR) throw new Error("默认仅允许 Wi-Fi 下载；确认使用移动网络后再试");
  await ensureDirectory(packRoot);
  const staging = `${packRoot}.staging-${manifest.voiceId}-${manifest.version}/`;
  const finalDirectory = `${packRoot}${manifest.voiceId}/${manifest.version}/`;
  const rollbackDirectory = `${packRoot}${manifest.voiceId}/.${manifest.version}.rollback/`;
  const priorDevice = await getDeviceState();
  const resume = priorDevice.pausedDownload?.manifest.voiceId === manifest.voiceId
    && priorDevice.pausedDownload.manifest.version === manifest.version
    ? priorDevice.pausedDownload
    : null;
  if (!resume) await FileSystem.deleteAsync(staging, { idempotent: true });
  await ensureDirectory(staging);
  const totalBytes = manifest.resources.reduce((sum, resource) => sum + resource.bytes, 0);
  let completedBytes = 0;
  try {
    for (const resource of manifest.resources) {
      safeResourcePath(resource.path);
      if (!resource.url.startsWith("https://")) throw new Error("音色包只允许从 HTTPS 受控地址下载");
      const destination = `${staging}${resource.path}`;
      await ensureDirectory(destination.slice(0, destination.lastIndexOf("/") + 1));
      const existing = await FileSystem.getInfoAsync(destination);
      if (existing.exists && await sha256File(destination) === resource.sha256.toLowerCase()) {
        completedBytes += resource.bytes;
        continue;
      }
      activeDownloadContext = { manifest, resourcePath: resource.path, completedBytes, resumeData: "" };
      activeDownload = FileSystem.createDownloadResumable(resource.url, destination, {}, ({ totalBytesWritten }) => {
        options.onProgress?.(Math.min(1, (completedBytes + totalBytesWritten) / Math.max(1, totalBytes)));
      }, resume?.resourcePath === resource.path ? resume.resumeData : undefined);
      const result = await activeDownload.downloadAsync();
      activeDownload = null;
      activeDownloadContext = null;
      if (!result?.uri) {
        const pausedState = (await getDeviceState()).pausedDownload;
        if (pausedState?.manifest.voiceId === manifest.voiceId && pausedState.manifest.version === manifest.version) {
          throw new Error("下载已暂停");
        }
        throw new Error(`下载失败：${resource.path}`);
      }
      const actualSha256 = await sha256File(result.uri);
      if (actualSha256.toLowerCase() !== resource.sha256.toLowerCase()) throw new Error(`摘要校验失败：${resource.path}`);
      completedBytes += resource.bytes;
      options.onProgress?.(Math.min(1, completedBytes / Math.max(1, totalBytes)));
    }
    await FileSystem.writeAsStringAsync(`${staging}manifest.json`, JSON.stringify(manifest));
    await ensureDirectory(`${packRoot}${manifest.voiceId}/`);
    await replaceVoicePackDirectory({
      info: (uri) => FileSystem.getInfoAsync(uri),
      remove: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
      move: (from, to) => FileSystem.moveAsync({ from, to }),
    }, staging, finalDirectory, rollbackDirectory);
    const latestDevice = await getDeviceState();
    const installedPacks = [...latestDevice.installedPacks.filter((item) => !(item.voiceId === manifest.voiceId && item.version === manifest.version)), manifest];
    await saveDeviceState({ ...latestDevice, installedPacks, pausedDownload: null });
    const preference = await getUserPreference(options.userId);
    await saveUserPreference(options.userId, { ...preference, selectedVoiceId: manifest.voiceId, selectedVersion: manifest.version });
    localSession = null;
    return manifest;
  } catch (error) {
    const paused = (await getDeviceState()).pausedDownload;
    if (paused?.manifest.voiceId !== manifest.voiceId || paused.manifest.version !== manifest.version) {
      await FileSystem.deleteAsync(staging, { idempotent: true });
    }
    activeDownload = null;
    activeDownloadContext = null;
    throw error;
  }
}

export async function pauseVoicePackDownload() {
  if (!activeDownload || !activeDownloadContext) return false;
  const paused = await activeDownload.pauseAsync();
  const state = await getDeviceState();
  await saveDeviceState({ ...state, pausedDownload: { ...activeDownloadContext, resumeData: paused.resumeData || "" } });
  activeDownload = null;
  activeDownloadContext = null;
  return true;
}

export async function resumeVoicePackDownload(options: { allowCellular?: boolean; onProgress?: (progress: number) => void; userId?: number } = {}) {
  const paused = (await getDeviceState()).pausedDownload;
  if (!paused) throw new Error("没有可恢复的音色包下载");
  return installVoicePack(paused.manifest, options);
}

export async function deleteVoicePack(userId?: number, deleteGeneratedAudio = false,
  target?: { voiceId: string; version: string }) {
  const [state, device] = await Promise.all([getVoicePackState(userId), getDeviceState()]);
  const manifest = target
    ? device.installedPacks.find((item) => item.voiceId === target.voiceId && item.version === target.version) || null
    : state.installed;
  if (!manifest) return state;
  await stopVoiceOutput();
  const preference = await getUserPreference(userId);
  if (isVoicePackSelected(preference, manifest.voiceId, manifest.version)) {
    await saveUserPreference(userId, { ...preference, selectedVoiceId: null, selectedVersion: null });
  }
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(`${VOICE_PREFERENCE_STORAGE_PREFIX}:`));
  const preferences = await AsyncStorage.multiGet(keys);
  const stillReferenced = preferences.some(([, value]) => {
    try {
      const other = JSON.parse(value || "null") as UserVoicePreference | null;
      return isVoicePackSelected(other, manifest.voiceId, manifest.version);
    } catch { return false; }
  });
  if (!stillReferenced && PACK_ROOT) {
    await FileSystem.deleteAsync(`${PACK_ROOT}${manifest.voiceId}/${manifest.version}/`, { idempotent: true });
    await FileSystem.deleteAsync(`${PACK_ROOT}${manifest.voiceId}/.${manifest.version}.rollback/`, { idempotent: true });
    const latest = await getDeviceState();
    await saveDeviceState({ ...latest,
      installedPacks: latest.installedPacks.filter((item) => !(item.voiceId === manifest.voiceId && item.version === manifest.version)),
      benchmarks: Object.fromEntries(Object.entries(latest.benchmarks)
        .filter(([key]) => key !== `${manifest.voiceId}@${manifest.version}`)),
    });
  }
  if (localSession?.key === `${manifest.voiceId}@${manifest.version}`) localSession = null;
  if (deleteGeneratedAudio) {
    await purgeVoiceAudioCacheForPack(
      manifest.voiceId,
      manifest.version,
      userId,
      !stillReferenced,
    );
  }
  return getVoicePackState(userId);
}

export async function removeRevokedVoicePacks(revoked: Array<{ voiceId: string; version: string }>) {
  if (!revoked.length) return;
  await stopVoiceOutput();
  const revokedKeys = new Set(revoked.map((item) => `${item.voiceId}@${item.version}`));
  const device = await getDeviceState();
  const removed = device.installedPacks.filter((item) => revokedKeys.has(`${item.voiceId}@${item.version}`));
  if (PACK_ROOT) {
    await Promise.all(removed.map((item) => FileSystem.deleteAsync(
      `${PACK_ROOT}${item.voiceId}/${item.version}/`,
      { idempotent: true },
    )));
  }
  if (removed.length) {
    await saveDeviceState({
      ...device,
      installedPacks: device.installedPacks.filter((item) => !revokedKeys.has(`${item.voiceId}@${item.version}`)),
      benchmarks: Object.fromEntries(Object.entries(device.benchmarks).filter(([key]) => !revokedKeys.has(key))),
    });
  }
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(`${VOICE_PREFERENCE_STORAGE_PREFIX}:`));
  await Promise.all(keys.map(async (key) => {
    try {
      const preference = JSON.parse(await AsyncStorage.getItem(key) || "null") as UserVoicePreference | null;
      if (preference && revokedKeys.has(`${preference.selectedVoiceId}@${preference.selectedVersion}`)) {
        await AsyncStorage.setItem(key, JSON.stringify({ ...preference, selectedVoiceId: null, selectedVersion: null }));
      }
    } catch {
      await AsyncStorage.removeItem(key);
    }
  }));
  if (localSession && revokedKeys.has(localSession.key)) localSession = null;
}

function encodePcmWav(samples: Float32Array, sampleRate: number) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return bytes;
}

async function localEngine(userId?: number) {
  const state = await getVoicePackState(userId);
  const manifest = state.installed;
  if (!manifest || Platform.OS === "web") throw new Error("本地音色包未安装");
  const packRoot = requireNativeRoot(PACK_ROOT);
  const key = `${manifest.voiceId}@${manifest.version}`;
  if (localSession?.key === key) return localSession;
  const directory = `${packRoot}${manifest.voiceId}/${manifest.version}/`;
  const processor = manifest.model.textProcessor || { type: "character-v1" as const };
  const [onnxRuntime, vocabularyText, tokenMapText] = await Promise.all([
    loadVoiceOnnxRuntime(),
    FileSystem.readAsStringAsync(`${directory}${safeResourcePath(manifest.model.vocabularyPath)}`),
    processor.type === "token-map-v1"
      ? FileSystem.readAsStringAsync(`${directory}${safeResourcePath(processor.mappingPath)}`)
      : Promise.resolve("{}"),
  ]);
  const started = Date.now();
  const session = await onnxRuntime.InferenceSession.create(`${directory}${safeResourcePath(manifest.model.path)}`);
  localSession = { key, session, vocabulary: JSON.parse(vocabularyText), tokenMap: JSON.parse(tokenMapText), manifest };
  const device = await getDeviceState();
  if (!device.benchmarks[key]) await saveDeviceState({ ...device, benchmarks: { ...device.benchmarks, [key]: {
    modelLoadMs: Date.now() - started, firstAudioMs: 0, realtimeFactor: 0, peakMemoryMb: null, passed: true, measuredAt: new Date().toISOString(),
  } } });
  return localSession;
}

async function synthesizeLocal(text: string, userId?: number) {
  const engine = await localEngine(userId);
  const { Tensor } = await loadVoiceOnnxRuntime();
  const ids = tokenizeVoiceText(text, engine.vocabulary, engine.manifest.model.textProcessor, engine.tokenMap);
  const names = engine.manifest.model.inputNames;
  const feeds: Record<string, any> = {
    [names.tokens]: new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    [names.lengths]: new Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
  };
  if (names.scales) feeds[names.scales] = new Tensor("float32", Float32Array.from([0.667, 1, 0.8]), [3]);
  if (names.speakerId) feeds[names.speakerId] = new Tensor("int64", BigInt64Array.from([BigInt(engine.manifest.model.speakerId || 0)]), [1]);
  const started = Date.now();
  const result = await engine.session.run(feeds);
  const output = result[engine.manifest.model.outputName || engine.session.outputNames[0]];
  if (!output || !(output.data instanceof Float32Array)) throw new Error("本地音色模型输出格式无效");
  const samples = output.data as Float32Array;
  const firstAudioMs = Date.now() - started;
  const durationMs = samples.length / engine.manifest.sampleRate * 1_000;
  const device = await getDeviceState();
  const benchmarkKey = `${engine.manifest.voiceId}@${engine.manifest.version}`;
  const previousBenchmark = device.benchmarks[benchmarkKey];
  const realtimeFactor = firstAudioMs / Math.max(1, durationMs);
  const passed = voiceBenchmarkPassed(firstAudioMs, realtimeFactor);
  await saveDeviceState({ ...device, benchmarks: { ...device.benchmarks, [benchmarkKey]: {
    modelLoadMs: previousBenchmark?.modelLoadMs || 0, firstAudioMs, realtimeFactor,
    peakMemoryMb: null, passed, measuredAt: new Date().toISOString(),
  } } });
  if (!passed) throw new Error("设备本地语音性能不足");
  return encodePcmWav(samples, engine.manifest.sampleRate);
}

export async function prewarmVoicePack(userId?: number) {
  const state = await getVoicePackState(userId);
  if (state.preference === "system-only" || !state.installed || Platform.OS === "web") return false;
  try {
    await localEngine(userId);
    return true;
  } catch {
    return false;
  }
}

export async function prefetchVoiceText(text: string, userId?: number) {
  const normalized = text.trim();
  if (!normalized) return false;
  const state = await getVoicePackState(userId);
  if (state.preference === "system-only" || !state.installed || state.benchmark?.passed === false || Platform.OS === "web") return false;
  try {
    await cachedAudio(normalized, userId, false, "local", async () => ({ bytes: await synthesizeLocal(normalized, userId), extension: "wav" }));
    return true;
  } catch {
    return false;
  }
}

async function cacheIndex(): Promise<Record<string, AudioCacheRow>> {
  try { return JSON.parse(await AsyncStorage.getItem(CACHE_INDEX_KEY) || "{}"); } catch { return {}; }
}

async function trimAudioCache(index: Record<string, AudioCacheRow>) {
  let total = Object.values(index).reduce((sum, row) => sum + row.bytes, 0);
  for (const [key, row] of Object.entries(index).sort((left, right) => left[1].accessedAt - right[1].accessedAt)) {
    if (total <= MAX_AUDIO_CACHE_BYTES) break;
    await FileSystem.deleteAsync(row.uri, { idempotent: true });
    total -= row.bytes;
    delete index[key];
  }
  await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
}

class VoiceCacheTaskCancelledError extends Error {}

function voiceCacheScope(userId: number | undefined, sensitive: boolean) {
  return sensitive ? `user:${userId || "anonymous"}` : "public";
}

async function cachedAudio(
  text: string,
  userId: number | undefined,
  sensitive: boolean,
  source: "local" | "server",
  producer: () => Promise<{ bytes: Uint8Array; extension: string }>,
  task = audioCacheTasks.begin(voiceCacheScope(userId, sensitive)),
) {
  const audioCacheRoot = requireNativeRoot(AUDIO_CACHE_ROOT);
  await ensureDirectory(audioCacheRoot);
  const state = await getVoicePackState(userId);
  const scope = voiceCacheScope(userId, sensitive);
  const voiceKey = state.installed
    ? `${state.installed.voiceId}@${state.installed.version}`
    : state.selectedVoiceId && state.selectedVersion
      ? `${state.selectedVoiceId}@${state.selectedVersion}`
      : "server";
  const key = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify({ schema: VOICE_CACHE_SCHEMA, source, voice: voiceKey, text, rate: 1, style: "default", format: "audio", scope }));
  const cached = await audioCacheTasks.commit(task, async () => {
    const index = await cacheIndex();
    const existing = index[key];
    if (existing?.expiresAt && existing.expiresAt <= Date.now()) {
      await FileSystem.deleteAsync(existing.uri, { idempotent: true }).catch(() => undefined);
      delete index[key];
      await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
    } else if (existing && (await FileSystem.getInfoAsync(existing.uri)).exists) {
      existing.accessedAt = Date.now();
      await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
      if (!audioCacheTasks.isCurrent(task)) throw new VoiceCacheTaskCancelledError();
      return existing.uri;
    }
    return null;
  });
  if (cached.status === "cancelled") throw new VoiceCacheTaskCancelledError();
  if (cached.value) return cached.value;

  const output = await producer();
  const committed = await audioCacheTasks.commit(task, async () => {
    const index = await cacheIndex();
    const existing = index[key];
    if (existing && (await FileSystem.getInfoAsync(existing.uri)).exists) return existing.uri;

    const uri = `${audioCacheRoot}${key}.${output.extension}`;
    const temporaryUri = `${uri}.tmp-${++audioCacheTempSequence}`;
    try {
      await FileSystem.writeAsStringAsync(temporaryUri, Base64.fromUint8Array(output.bytes), { encoding: "base64" });
      if (!audioCacheTasks.isCurrent(task)) throw new VoiceCacheTaskCancelledError();
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      await FileSystem.moveAsync({ from: temporaryUri, to: uri });
      if (!audioCacheTasks.isCurrent(task)) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
        throw new VoiceCacheTaskCancelledError();
      }
      index[key] = {
        uri,
        bytes: output.bytes.byteLength,
        accessedAt: Date.now(),
        expiresAt: sensitive ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
        sensitive,
        userScope: scope,
        voiceKey,
      };
      await trimAudioCache(index);
      if (!audioCacheTasks.isCurrent(task)) throw new VoiceCacheTaskCancelledError();
      return uri;
    } catch (error) {
      await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
      throw error;
    }
  });
  if (committed.status === "cancelled") throw new VoiceCacheTaskCancelledError();
  return committed.value;
}

async function playUri(uri: string, generation: number) {
  if (generation !== playbackGeneration) return;
  if (activeSound) await activeSound.unloadAsync().catch(() => undefined);
  if (generation !== playbackGeneration) return;
  const created = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
  if (generation !== playbackGeneration) {
    await created.sound.unloadAsync().catch(() => undefined);
    return;
  }
  activeSound = created.sound;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    created.sound.setOnPlaybackStatusUpdate((status) => {
      if (voicePlaybackFinished(status)) finish();
    });
  });
  created.sound.setOnPlaybackStatusUpdate(null);
  await created.sound.unloadAsync().catch(() => undefined);
  if (activeSound === created.sound) activeSound = null;
}

function sentences(text: string) {
  return text.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map((item) => item.trim()).filter(Boolean) || [text];
}

async function speakWithGeneration(apiFetch: ApiFetch, text: string,
  options: { userId?: number; sensitive?: boolean }, generation: number): Promise<VoiceSource> {
  const cacheTask = audioCacheTasks.begin(voiceCacheScope(options.userId, Boolean(options.sensitive)));
  const state = await getVoicePackState(options.userId);
  if (state.preference !== "system-only" && state.installed && state.benchmark?.passed !== false) {
    try {
      for (const sentence of sentences(text)) {
        if (generation !== playbackGeneration) return "local";
        const uri = await cachedAudio(sentence, options.userId, Boolean(options.sensitive), "local", async () => ({ bytes: await synthesizeLocal(sentence, options.userId), extension: "wav" }), cacheTask);
        await playUri(uri, generation);
      }
      return "local";
    } catch (error) {
      if (error instanceof VoiceCacheTaskCancelledError || generation !== playbackGeneration) return "local";
      // Continue to the configured server TTS.
    }
  }
  if (state.preference !== "system-only") {
    try {
      if (generation !== playbackGeneration || !audioCacheTasks.isCurrent(cacheTask)) return "server";
      const synthesizeServer = async () => {
        if (generation !== playbackGeneration || !audioCacheTasks.isCurrent(cacheTask)) throw new VoiceCacheTaskCancelledError();
        const response = await voicePackApi.synthesize(apiFetch, text, state.selectedVoiceId && state.selectedVersion
          ? { voiceId: state.selectedVoiceId, version: state.selectedVersion }
          : undefined);
        if (generation !== playbackGeneration || !audioCacheTasks.isCurrent(cacheTask)) throw new VoiceCacheTaskCancelledError();
        return response;
      };
      const uri = Platform.OS === "web"
        ? await synthesizeServer().then((response) => `data:${response.mimeType || "audio/mpeg"};base64,${response.audioBase64}`)
        : await cachedAudio(text, options.userId, Boolean(options.sensitive), "server", async () => {
          const response = await synthesizeServer();
          return { bytes: Base64.toUint8Array(response.audioBase64), extension: "mp3" };
        }, cacheTask);
      await playUri(uri, generation);
      return "server";
    } catch (error) {
      if (error instanceof VoiceCacheTaskCancelledError || generation !== playbackGeneration) return "server";
      // The system voice is the final, offline-capable fallback.
    }
  }
  if (generation === playbackGeneration) await new Promise<void>((resolve) => Speech.speak(text, {
    language: "zh-CN",
    rate: 1,
    onDone: resolve,
    onStopped: resolve,
    onError: () => resolve(),
  }));
  return "system";
}

let streamGeneration = 0;
let captureStreamId: string | null = null;
const streamQueue = new KeyedSerialQueue<VoiceSource>();

export async function speakWithVoiceFallback(apiFetch: ApiFetch, text: string, options: { userId?: number; sensitive?: boolean } = {}): Promise<VoiceSource> {
  captureStreamId = null;
  const finishOutput = beginVoiceOutput(true);
  streamQueue.cancel();
  const generation = ++playbackGeneration;
  streamGeneration = generation;
  try {
    await stopActiveSoundOnly();
    return await speakWithGeneration(apiFetch, text, options, generation);
  } finally { finishOutput(); }
}

export function enqueueVoiceOutput(apiFetch: ApiFetch, text: string,
  options: { streamId: string; userId?: number; sensitive?: boolean }): Promise<VoiceSource | null> {
  const finishOutput = beginVoiceOutput(captureStreamId !== options.streamId);
  captureStreamId = options.streamId;
  return streamQueue.enqueue(options.streamId, async () => {
    streamGeneration = ++playbackGeneration;
    await stopActiveSoundOnly();
  }, () => speakWithGeneration(apiFetch, text, options, streamGeneration)).finally(finishOutput);
}

async function stopActiveSoundOnly() {
  if (activeSound) {
    await activeSound.stopAsync().catch(() => undefined);
    await activeSound.unloadAsync().catch(() => undefined);
    activeSound = null;
  }
  await Speech.stop();
}

export async function stopVoiceOutput() {
  captureStreamId = null;
  const finishOutput = beginVoiceOutput(true);
  streamQueue.cancel();
  playbackGeneration += 1;
  try { await stopActiveSoundOnly(); } finally { finishOutput(); }
}

export async function purgeVoiceAudioCache() {
  await audioCacheTasks.invalidateAll(async () => {
    if (AUDIO_CACHE_ROOT) await FileSystem.deleteAsync(AUDIO_CACHE_ROOT, { idempotent: true });
    await AsyncStorage.removeItem(CACHE_INDEX_KEY);
  });
}

export async function purgeVoiceAudioCacheForUser(userId?: number | null) {
  if (!userId) return;
  const scope = `user:${userId}`;
  await audioCacheTasks.invalidate(scope, async () => {
    const index = await cacheIndex();
    for (const [key, row] of Object.entries(index)) {
      if (row.userScope !== scope) continue;
      await FileSystem.deleteAsync(row.uri, { idempotent: true }).catch(() => undefined);
      delete index[key];
    }
    await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
  });
}

async function purgeVoiceAudioCacheForPack(
  voiceId: string,
  version: string,
  userId: number | undefined,
  includeShared: boolean,
) {
  const voiceKey = `${voiceId}@${version}`;
  const userScope = `user:${userId || "anonymous"}`;
  const purge = async () => {
    const index = await cacheIndex();
    for (const [key, row] of Object.entries(index)) {
      if (row.voiceKey !== voiceKey || (!includeShared && row.userScope !== userScope)) continue;
      await FileSystem.deleteAsync(row.uri, { idempotent: true }).catch(() => undefined);
      delete index[key];
    }
    await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
  };
  if (includeShared) await audioCacheTasks.invalidateAll(purge);
  else await audioCacheTasks.invalidate(userScope, purge);
}
