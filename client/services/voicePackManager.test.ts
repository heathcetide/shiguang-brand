const mockStorage = new Map<string, string>();
const mockFiles = new Set<string>();
let mockWriteHook: ((uri: string) => Promise<void>) | null = null;

const mockSynthesize = jest.fn();
const mockRun = jest.fn();
const mockCreateSession = jest.fn(async () => ({
  run: (...args: unknown[]) => mockRun(...args),
  outputNames: ["audio"],
}));
const mockWriteAsStringAsync = jest.fn(async (uri: string) => {
  if (mockWriteHook) await mockWriteHook(uri);
  mockFiles.add(uri);
});
const mockMoveAsync = jest.fn(async ({ from, to }: { from: string; to: string }) => {
  mockFiles.delete(from);
  mockFiles.add(to);
});
const mockDeleteAsync = jest.fn(async (uri: string) => {
  for (const path of [...mockFiles]) {
    if (path === uri || path.startsWith(uri)) mockFiles.delete(path);
  }
});
function mockLegacyFileSystem() {
  return {
    documentDirectory: "file:///documents/",
    cacheDirectory: "file:///cache/",
    getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri) })),
    makeDirectoryAsync: jest.fn(async (uri: string) => { mockFiles.add(uri); }),
    deleteAsync: (...args: Parameters<typeof mockDeleteAsync>) => mockDeleteAsync(...args),
    moveAsync: (...args: Parameters<typeof mockMoveAsync>) => mockMoveAsync(...args),
    writeAsStringAsync: (...args: Parameters<typeof mockWriteAsStringAsync>) => mockWriteAsStringAsync(...args),
    readAsStringAsync: jest.fn(async (uri: string) => uri.endsWith("vocabulary.json")
      ? JSON.stringify({ "<bos>": 1, "<eos>": 2, "<unk>": 0 })
      : "{}"),
    createDownloadResumable: jest.fn(),
  };
}

jest.mock("@react-native-async-storage/async-storage", () => {
  const storage = {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map((key) => [key, mockStorage.get(key) ?? null])),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((key) => mockStorage.delete(key)); }),
  };
  return { __esModule: true, default: storage };
});

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("expo-file-system", () => ({ File: jest.fn(), ...mockLegacyFileSystem() }));
jest.mock("expo-file-system/src/legacy", () => mockLegacyFileSystem());
jest.mock("expo-file-system/legacy", () => mockLegacyFileSystem());
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: jest.fn(async (_algorithm: string, input: string) => {
    let hash = 0;
    for (const character of input) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return `cache-${hash.toString(16)}`;
  }),
}));
jest.mock("expo-network", () => ({
  NetworkStateType: { CELLULAR: "CELLULAR" },
  getNetworkStateAsync: jest.fn(),
}));
jest.mock("expo-speech", () => ({
  stop: jest.fn(async () => undefined),
  speak: jest.fn((_text: string, options: { onDone?: () => void }) => options.onDone?.()),
}));
jest.mock("expo-av", () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn(async () => {
        const sound = {
          setOnPlaybackStatusUpdate: jest.fn((callback: null | ((status: unknown) => void)) => {
            callback?.({ isLoaded: true, didJustFinish: true });
          }),
          stopAsync: jest.fn(async () => undefined),
          unloadAsync: jest.fn(async () => undefined),
        };
        return { sound };
      }),
    },
  },
}));
jest.mock("@/services/voiceOnnxRuntime", () => ({
  loadVoiceOnnxRuntime: jest.fn(async () => ({
    InferenceSession: {
      create: (...args: unknown[]) => mockCreateSession(...args),
    },
    Tensor: class {
      readonly mocked = true;
    },
  })),
}));
jest.mock("@/services/api/ai", () => ({
  voicePackApi: { synthesize: (...args: unknown[]) => mockSynthesize(...args) },
}));

import { Audio } from "expo-av";
import * as Crypto from "expo-crypto";
import * as Speech from "expo-speech";

import {
  enqueueVoiceOutput,
  getVoicePackState,
  prefetchVoiceText,
  purgeVoiceAudioCache,
  purgeVoiceAudioCacheForUser,
  speakWithVoiceFallback,
  stopVoiceOutput,
} from "./voicePackManager";
import { isVoiceOutputBlockingCapture } from "./voiceCaptureGate";
import { voicePreferenceStorageKey } from "./voicePreferenceScope";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForCall(mock: jest.Mock, count = 1) {
  for (let attempt = 0; attempt < 50 && mock.mock.calls.length < count; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  expect(mock).toHaveBeenCalledTimes(count);
}

describe("voice audio cache account lifecycle", () => {
  beforeEach(async () => {
    await stopVoiceOutput();
    await purgeVoiceAudioCache();
    mockStorage.clear();
    mockFiles.clear();
    mockWriteHook = null;
    jest.clearAllMocks();
  });

  it("does not let a cancelled stream suppress the immediately replacing speech", async () => {
    mockStorage.set(voicePreferenceStorageKey(101), JSON.stringify({ preference: "system-only", version: 1 }));
    const stale = enqueueVoiceOutput(jest.fn(), "已取消的分段", { streamId: "old-stream", userId: 101 });
    const current = speakWithVoiceFallback(jest.fn(), "现在播报", { userId: 101 });
    await expect(stale).resolves.toBeNull();
    await current;
    expect(Speech.speak).toHaveBeenCalledTimes(1);
    expect(Speech.speak).toHaveBeenCalledWith("现在播报", expect.any(Object));
  });

  it("keeps capture blocked when an old synthesis finishes after replacement", async () => {
    const old = deferred<{ audioBase64: string; mimeType: string }>();
    const current = deferred<{ audioBase64: string; mimeType: string }>();
    mockSynthesize.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const first = speakWithVoiceFallback(jest.fn(), "旧回答", { userId: 101 });
    await waitForCall(mockSynthesize);
    const second = speakWithVoiceFallback(jest.fn(), "新回答", { userId: 101 });
    await waitForCall(mockSynthesize, 2);
    old.resolve({ audioBase64: "AQID", mimeType: "audio/mpeg" });
    await first;
    expect(isVoiceOutputBlockingCapture()).toBe(true);
    current.resolve({ audioBase64: "AQID", mimeType: "audio/mpeg" });
    await second;
  });

  it("does not cache a sensitive server response that completes after logout", async () => {
    const synthesis = deferred<{ audioBase64: string; mimeType: string }>();
    mockSynthesize.mockReturnValueOnce(synthesis.promise);

    const speech = speakWithVoiceFallback(jest.fn(), "私人健康音频", { userId: 101, sensitive: true });
    await waitForCall(mockSynthesize);
    await stopVoiceOutput();
    const cleanup = purgeVoiceAudioCacheForUser(101);
    synthesis.resolve({ audioBase64: "AQID", mimeType: "audio/mpeg" });

    await Promise.all([speech, cleanup]);
    expect(mockWriteAsStringAsync).not.toHaveBeenCalled();
    expect(mockStorage.get("voice-audio-cache-index-v1")).toBe("{}");
  });

  it("does not cache local synthesis that completes after logout", async () => {
    const modelRun = deferred<{ audio: { data: Float32Array } }>();
    mockRun.mockReturnValueOnce(modelRun.promise);
    mockStorage.set("voice-pack-device-state-v2", JSON.stringify({
      installedPacks: [localManifest],
      benchmarks: {
        "local-test@1.0.0": {
          modelLoadMs: 10,
          firstAudioMs: 10,
          realtimeFactor: 0.1,
          peakMemoryMb: null,
          passed: true,
          measuredAt: "2026-09-05T00:00:00.000Z",
        },
      },
      pausedDownload: null,
    }));
    mockStorage.set(voicePreferenceStorageKey(101), JSON.stringify({
      selectedVoiceId: "local-test",
      selectedVersion: "1.0.0",
      preference: "automatic",
      version: 1,
    }));
    expect((await getVoicePackState(101)).installed?.voiceId).toBe("local-test");

    const speech = speakWithVoiceFallback(jest.fn(), "本地私人语音", { userId: 101, sensitive: true });
    await waitForCall(mockCreateSession);
    await waitForCall(mockRun);
    await stopVoiceOutput();
    const cleanup = purgeVoiceAudioCacheForUser(101);
    modelRun.resolve({ audio: { data: new Float32Array(24_000) } });

    await Promise.all([speech, cleanup]);
    expect(mockSynthesize).not.toHaveBeenCalled();
    expect(mockWriteAsStringAsync).not.toHaveBeenCalled();
    expect(mockStorage.get("voice-audio-cache-index-v1")).toBe("{}");
  });

  it("removes a temporary file when logout invalidates an active cache write", async () => {
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    mockSynthesize.mockResolvedValueOnce({ audioBase64: "AQID", mimeType: "audio/mpeg" });
    mockWriteHook = async (uri) => {
      if (!uri.includes(".tmp-")) return;
      writeStarted.resolve();
      await releaseWrite.promise;
    };

    const speech = speakWithVoiceFallback(jest.fn(), "正在写入的私人语音", { userId: 101, sensitive: true });
    await writeStarted.promise;
    await stopVoiceOutput();
    const cleanup = purgeVoiceAudioCacheForUser(101);
    releaseWrite.resolve();

    await Promise.all([speech, cleanup]);
    expect(mockMoveAsync).not.toHaveBeenCalled();
    expect([...mockFiles].some((uri) => uri.includes(".tmp-"))).toBe(false);
    expect(mockStorage.get("voice-audio-cache-index-v1")).toBe("{}");
  });

  it("keeps an old account response out of a newly active account cache", async () => {
    const accountAResponse = deferred<{ audioBase64: string; mimeType: string }>();
    mockSynthesize
      .mockReturnValueOnce(accountAResponse.promise)
      .mockResolvedValueOnce({ audioBase64: "BAUG", mimeType: "audio/mpeg" });

    const accountA = speakWithVoiceFallback(jest.fn(), "账号 A 的私人语音", { userId: 101, sensitive: true });
    await waitForCall(mockSynthesize);
    await stopVoiceOutput();
    await purgeVoiceAudioCacheForUser(101);
    const accountB = speakWithVoiceFallback(jest.fn(), "账号 B 的私人语音", { userId: 202, sensitive: true });
    await waitForCall(mockSynthesize, 2);
    accountAResponse.resolve({ audioBase64: "AQID", mimeType: "audio/mpeg" });

    await Promise.all([accountA, accountB]);
    const index = JSON.parse(mockStorage.get("voice-audio-cache-index-v1") || "{}") as Record<string, { userScope: string }>;
    expect(Object.values(index).map((row) => row.userScope)).toEqual(["user:202"]);
  });

  it("does not reuse cached server fallback as local audio when local inference recovers", async () => {
    selectLocalVoice();
    mockRun.mockRejectedValueOnce(new Error("Local runtime temporarily unavailable"))
      .mockResolvedValueOnce({ audio: { data: new Float32Array(24_000) } });
    mockSynthesize.mockResolvedValueOnce({ audioBase64: "AQID", mimeType: "audio/mpeg" });

    expect(await speakWithVoiceFallback(jest.fn(), "同一句话", { userId: 101 })).toBe("server");
    expect(await speakWithVoiceFallback(jest.fn(), "同一句话", { userId: 101 })).toBe("local");

    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockSynthesize).toHaveBeenCalledTimes(1);
    const played = jest.mocked(Audio.Sound.createAsync).mock.calls.map(([source]) => source);
    expect(played).toEqual([{ uri: expect.stringMatching(/\.mp3$/) }, { uri: expect.stringMatching(/\.wav$/) }]);
  });

  it("reuses server cache without another API request and isolates sensitive accounts", async () => {
    mockSynthesize.mockResolvedValue({ audioBase64: "AQID", mimeType: "audio/mpeg" });
    const apiFetch = jest.fn();
    const options = { userId: 101, sensitive: true };
    expect(await speakWithVoiceFallback(apiFetch, "同一句私人语音", options)).toBe("server");
    expect(await speakWithVoiceFallback(apiFetch, "同一句私人语音", options)).toBe("server");
    expect(mockSynthesize).toHaveBeenCalledTimes(1);
    const firstUri = jest.mocked(Audio.Sound.createAsync).mock.calls[0][0];
    expect(jest.mocked(Audio.Sound.createAsync).mock.calls[1][0]).toEqual(firstUri);

    await speakWithVoiceFallback(apiFetch, "同一句私人语音", { userId: 202, sensitive: true });
    expect(mockSynthesize).toHaveBeenCalledTimes(2);
    expect(jest.mocked(Audio.Sound.createAsync).mock.calls[2][0]).not.toEqual(firstUri);
    const index = JSON.parse(mockStorage.get("voice-audio-cache-index-v1") || "{}");
    expect(Object.values(index).map((row: any) => row.userScope).sort()).toEqual(["user:101", "user:202"]);
  });

  it("ignores ambiguous schema 2 entries instead of attributing them to local", async () => {
    selectLocalVoice();
    const key = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify({
      schema: 2, voice: "local-test@1.0.0", text: "旧缓存", rate: 1, style: "default", format: "audio", scope: "public",
    }));
    const uri = "file:///cache/voice-output-v1/ambiguous.mp3";
    mockFiles.add(uri);
    mockStorage.set("voice-audio-cache-index-v1", JSON.stringify({ [key]: {
      uri, bytes: 3, accessedAt: Date.now(), sensitive: false, userScope: "public", voiceKey: "local-test@1.0.0",
    } }));
    mockRun.mockResolvedValueOnce({ audio: { data: new Float32Array(24_000) } });
    expect(await speakWithVoiceFallback(jest.fn(), "旧缓存", { userId: 101 })).toBe("local");
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(Audio.Sound.createAsync).toHaveBeenCalledWith({ uri: expect.stringMatching(/\.wav$/) }, { shouldPlay: true });
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it("shares local prefetch with local playback without server requests", async () => {
    selectLocalVoice();
    mockRun.mockResolvedValueOnce({ audio: { data: new Float32Array(24_000) } });
    expect(await prefetchVoiceText("预读语音", 101)).toBe(true);
    expect(await speakWithVoiceFallback(jest.fn(), "预读语音", { userId: 101 })).toBe("local");
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it("honors system-only even when server audio is cached", async () => {
    mockSynthesize.mockResolvedValueOnce({ audioBase64: "AQID", mimeType: "audio/mpeg" });
    await speakWithVoiceFallback(jest.fn(), "系统偏好", { userId: 101 });
    mockStorage.set(voicePreferenceStorageKey(101), JSON.stringify({ preference: "system-only" }));
    jest.clearAllMocks();
    expect(await speakWithVoiceFallback(jest.fn(), "系统偏好", { userId: 101 })).toBe("system");
    expect(Speech.speak).toHaveBeenCalledTimes(1);
    expect(mockSynthesize).not.toHaveBeenCalled();
    expect(Audio.Sound.createAsync).not.toHaveBeenCalled();
  });

  it("keeps selected voice versions separate and passes selection to server synthesis", async () => {
    mockSynthesize.mockResolvedValue({ audioBase64: "AQID", mimeType: "audio/mpeg" });
    const apiFetch = jest.fn();
    for (const version of ["1.0.0", "2.0.0"]) {
      mockStorage.set(voicePreferenceStorageKey(101), JSON.stringify({
        selectedVoiceId: "cloud-test", selectedVersion: version, preference: "automatic", version: 1,
      }));
      await speakWithVoiceFallback(apiFetch, "指定音色", { userId: 101 });
      expect(mockSynthesize).toHaveBeenLastCalledWith(apiFetch, "指定音色", { voiceId: "cloud-test", version });
    }
    expect(mockSynthesize).toHaveBeenCalledTimes(2);
    expect(jest.mocked(Audio.Sound.createAsync).mock.calls[0][0])
      .not.toEqual(jest.mocked(Audio.Sound.createAsync).mock.calls[1][0]);
  });

  it("does not write, play or system-fallback a server result after playback cancellation", async () => {
    const response = deferred<{ audioBase64: string; mimeType: string }>();
    mockSynthesize.mockReturnValueOnce(response.promise);
    const speech = speakWithVoiceFallback(jest.fn(), "已取消语音", { userId: 101 });
    await waitForCall(mockSynthesize);
    await stopVoiceOutput();
    response.resolve({ audioBase64: "AQID", mimeType: "audio/mpeg" });
    await speech;
    expect(mockWriteAsStringAsync).not.toHaveBeenCalled();
    expect(Audio.Sound.createAsync).not.toHaveBeenCalled();
    expect(Speech.speak).not.toHaveBeenCalled();
  });

});

const localManifest = {
  voiceId: "local-test",
  name: "本地测试音色",
  version: "1.0.0",
  language: "zh-CN",
  sampleRate: 24_000,
  outputFormat: "pcm-f32",
  minimumAppVersion: "1.0.0",
  minimumMemoryMb: 256,
  resources: [],
  model: {
    path: "model.onnx",
    vocabularyPath: "vocabulary.json",
    inputNames: { tokens: "tokens", lengths: "lengths" },
    outputName: "audio",
    textProcessor: { type: "character-v1" },
  },
};

function selectLocalVoice() {
  mockStorage.set("voice-pack-device-state-v2", JSON.stringify({
    installedPacks: [localManifest], benchmarks: {}, pausedDownload: null,
  }));
  mockStorage.set(voicePreferenceStorageKey(101), JSON.stringify({
    selectedVoiceId: "local-test", selectedVersion: "1.0.0", preference: "automatic", version: 1,
  }));
}
