import React from "react";
import { AppState, Platform } from "react-native";
import renderer, { act } from "react-test-renderer";
import * as Network from "expo-network";
import { Audio } from "expo-av";

import { ApiError, ApiTransportError, aiApi, realtimeVoiceApi, type RealtimeVoiceSession } from "@/services/api";
import { beginVoiceOutput } from "@/services/voiceCaptureGate";
import { useRealtimeCookingVoice } from "./useRealtimeCookingVoice";

const mockStartNativeRecording = jest.fn();
const mockStopNativeRecording = jest.fn();
const mockPauseNativeRecording = jest.fn();
const mockResumeNativeRecording = jest.fn();
const mockAuthFetch = jest.fn();

jest.mock("@/contexts/AuthContext", () => ({ useAuthFetch: () => mockAuthFetch }));
jest.mock("@siteed/audio-studio", () => ({
  useAudioRecorder: () => ({
    startRecording: mockStartNativeRecording,
    stopRecording: mockStopNativeRecording,
    pauseRecording: mockPauseNativeRecording,
    resumeRecording: mockResumeNativeRecording,
  }),
}));
jest.mock("expo-network", () => ({
  addNetworkStateListener: jest.fn(), getNetworkStateAsync: jest.fn(),
}));
jest.mock("expo-av", () => ({ Audio: { requestPermissionsAsync: jest.fn() } }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
jest.mock("@/services/api", () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, body?: { code?: string }) {
      super(message); this.status = status; this.code = body?.code;
    }
  }
  return {
    ApiError,
    ApiTransportError: class ApiTransportError extends Error {},
    aiApi: { transcribe: jest.fn() },
    waitForAgentRun: jest.fn(),
    realtimeVoiceApi: {
      create: jest.fn(), heartbeat: jest.fn(), events: jest.fn(), close: jest.fn(),
      audioChunk: jest.fn(), turn: jest.fn(),
    },
  };
});

const createdSession: RealtimeVoiceSession = {
  id: "00000000-0000-4000-8000-000000000002",
  recipeId: 42,
  status: "active",
  platform: "android",
  version: 1,
  connectedAt: "2026-09-06T00:00:00.000Z",
  expiresAt: "2026-09-06T02:00:00.000Z",
  metrics: { firstTranscriptMs: null, firstResponseMs: null, interruptions: 0, reconnects: 0, fallbacks: 0 },
};

const options = {
  recipeId: 42,
  currentStep: 0,
  timerSeconds: 0,
  timerRunning: false,
  recipeSteps: ["准备", "完成"],
  recipeIngredients: ["番茄 2个"],
  onTranscript: jest.fn(), onBargeIn: jest.fn(), onStopOutput: jest.fn(), onControl: jest.fn(),
  onAnswerDelta: jest.fn(), onAnswer: jest.fn(), onConfirmationRequired: jest.fn(), onError: jest.fn(),
};

describe("useRealtimeCookingVoice startup cleanup", () => {
  let voice!: ReturnType<typeof useRealtimeCookingVoice>;
  let tree!: renderer.ReactTestRenderer;

  function Harness({ onUpdate, focused = true, scopeKey = "A" }: { onUpdate: (value: ReturnType<typeof useRealtimeCookingVoice>) => void; focused?: boolean; scopeKey?: string }) {
    const value = useRealtimeCookingVoice({ ...options, focused, scopeKey });
    React.useEffect(() => onUpdate(value), [onUpdate, value]);
    return null;
  }

  beforeEach(async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    jest.clearAllMocks();
    window.addEventListener = jest.fn();
    window.removeEventListener = jest.fn();
    jest.mocked(Network.addNetworkStateListener).mockReturnValue({ remove: jest.fn() });
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({ isConnected: true });
    jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
    mockPauseNativeRecording.mockResolvedValue(undefined);
    mockResumeNativeRecording.mockResolvedValue(undefined);
    mockStartNativeRecording.mockResolvedValue(undefined);
    jest.mocked(Audio.requestPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(realtimeVoiceApi.heartbeat).mockImplementation(async (_fetch, _id, input) => ({ session: { ...createdSession, version: input.version + 1, status: input.muted ? "muted" : "active" } }));
    mockStopNativeRecording.mockResolvedValue(undefined);
    jest.mocked(realtimeVoiceApi.create).mockResolvedValue({ session: createdSession, repeated: false });
    jest.mocked(realtimeVoiceApi.close).mockResolvedValue({ session: { ...createdSession, status: "closed" } });
    await act(async () => {
      tree = renderer.create(<Harness onUpdate={(value) => { voice = value; }} />);
    });
  });

  afterEach(async () => {
    await act(async () => { tree.unmount(); });
  });

  it.each(["blur", "account"])("invalidates a late native start on %s and requires explicit restart", async reason => {
    let resolve!: () => void;
    mockStartNativeRecording.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
    let starting!: Promise<boolean>;
    await act(async () => { starting = voice.start(); });
    expect(mockStartNativeRecording).toHaveBeenCalledTimes(1);
    const callback = (value: ReturnType<typeof useRealtimeCookingVoice>) => { voice = value; };
    await act(async () => { tree.update(<Harness focused={reason !== "blur"} scopeKey={reason === "account" ? "B" : "A"} onUpdate={callback} />); });
    await act(async () => { resolve(); await starting; });
    expect(voice.active).toBe(false);
    expect(mockStopNativeRecording).toHaveBeenCalled();
    expect(realtimeVoiceApi.close).toHaveBeenCalledWith(mockAuthFetch, createdSession.id);
    await act(async () => { tree.update(<Harness onUpdate={callback} />); });
    expect(mockStartNativeRecording).toHaveBeenCalledTimes(1);
    expect(options.onTranscript).not.toHaveBeenCalled();
    expect(options.onControl).not.toHaveBeenCalled();
  });

  it.each(["start", "failed start", "resume"])("holds the singleton lease across unmount and late %s cleanup", async stage => {
    let hardwareOwner = "none";
    let releaseOperation!: () => void;
    let rejectOperation!: (error: Error) => void;
    let releaseCleanup!: () => void;
    const operation = new Promise<void>((resolve, reject) => { releaseOperation = resolve; rejectOperation = reject; });
    const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
    mockStartNativeRecording.mockImplementation(async () => { hardwareOwner = "new"; });
    mockStopNativeRecording.mockImplementation(async () => { hardwareOwner = "none"; });
    mockStopNativeRecording.mockImplementationOnce(async () => { await cleanup; hardwareOwner = "none"; });
    if (stage === "resume") {
      await act(async () => { await voice.start(); await voice.toggleMute(); });
      mockResumeNativeRecording.mockImplementationOnce(async () => { await operation; hardwareOwner = "old"; });
    } else {
      mockStartNativeRecording.mockImplementationOnce(async () => { await operation; hardwareOwner = "old"; });
    }
    let oldOperation!: Promise<boolean>;
    await act(async () => { oldOperation = stage === "resume" ? voice.toggleMute() : voice.start(); });
    await act(async () => { tree.unmount(); });
    await act(async () => { tree = renderer.create(<Harness onUpdate={value => { voice = value; }} />); });
    let newStart!: Promise<boolean>;
    await act(async () => { newStart = voice.start(); });
    expect(mockStartNativeRecording).toHaveBeenCalledTimes(1);
    expect(mockStopNativeRecording).not.toHaveBeenCalled();
    await act(async () => {
      if (stage === "failed start") rejectOperation(new Error("failed start"));
      else releaseOperation();
    });
    expect(mockStopNativeRecording).toHaveBeenCalledTimes(1);
    expect(mockStartNativeRecording).toHaveBeenCalledTimes(1);
    await act(async () => { releaseCleanup(); await oldOperation; expect(await newStart).toBe(true); });
    expect(hardwareOwner).toBe("new");
    expect(mockStartNativeRecording).toHaveBeenCalledTimes(2);
    expect(mockStopNativeRecording).toHaveBeenCalledTimes(1);
    expect(voice.state).toBe("listening");
  });

  it("does not deliver a late hardware-stop error to a new account", async () => {
    let reject!: (error: Error) => void;
    mockStopNativeRecording.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    await act(async () => { await voice.start(); });
    let stopping!: Promise<void>;
    await act(async () => { stopping = voice.stop(); });
    await act(async () => { tree.update(<Harness scopeKey="B" onUpdate={value => { voice = value; }} />); });
    await act(async () => { reject(new Error("old hardware error")); await stopping; });
    expect(options.onError).not.toHaveBeenCalled();
  });

  it("a cancelled FIFO waiter never stops or starts the singleton", async () => {
    await act(async () => { await voice.start(); });
    const owner = voice;
    let waiter!: ReturnType<typeof useRealtimeCookingVoice>;
    let waiterTree!: renderer.ReactTestRenderer;
    await act(async () => { waiterTree = renderer.create(<Harness onUpdate={value => { waiter = value; }} />); });
    let waiting!: Promise<boolean>;
    await act(async () => { waiting = waiter.start(); });
    await act(async () => { waiterTree.unmount(); });
    expect(mockStartNativeRecording).toHaveBeenCalledTimes(1);
    expect(mockStopNativeRecording).not.toHaveBeenCalled();
    await act(async () => { await owner.stop(); expect(await waiting).toBe(false); });
    expect(mockStopNativeRecording).toHaveBeenCalledTimes(1);
    expect(mockStartNativeRecording).toHaveBeenCalledTimes(1);
  });

  it("discards speaker output and its pre-roll without RMS interruption or ASR", async () => {
    jest.useFakeTimers();
    const finishOutput = beginVoiceOutput(true);
    try {
      await act(async () => { await voice.start(); });
      const recorder = mockStartNativeRecording.mock.calls[0][0];
      await act(async () => {
        await recorder.onAudioStream({ data: "AAAA" });
        await recorder.onAudioAnalysis({ dataPoints: [{ silent: false, rms: 0.8 }] });
        await recorder.onAudioStream({ data: "AAAA" });
        jest.advanceTimersByTime(300);
        await recorder.onAudioAnalysis({ dataPoints: [{ silent: true, rms: 0 }] });
        jest.advanceTimersByTime(650);
      });
      expect(options.onBargeIn).not.toHaveBeenCalled();
      expect(realtimeVoiceApi.audioChunk).not.toHaveBeenCalled();
      expect(realtimeVoiceApi.turn).not.toHaveBeenCalled();
      // Explicit mute/stop must remain available even when output is active.
      await act(async () => { await voice.toggleMute(); });
      expect(options.onStopOutput).toHaveBeenCalled();
      expect(voice.muted).toBe(true);
      await act(async () => { await voice.toggleMute(); await voice.stop(); });
      expect(voice.state).toBe("off");
    } finally { finishOutput(); jest.setSystemTime(0); beginVoiceOutput(true)(); jest.useRealTimers(); }
  });

  it("resumes clean native capture after output ends and ignores stale recorder callbacks", async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(realtimeVoiceApi.audioChunk).mockResolvedValue({ transcript: "下一步" } as never);
      jest.mocked(realtimeVoiceApi.turn).mockResolvedValue({ intent: "control", action: { action: "NEXT_STEP" } } as never);
      await act(async () => { await voice.start(); });
      const oldRecorder = mockStartNativeRecording.mock.calls[0][0];
      await act(async () => { await voice.stop(); await voice.start(); });
      const recorder = mockStartNativeRecording.mock.calls[1][0];
      const finish = beginVoiceOutput(true);
      await act(async () => { await recorder.onAudioStream({ data: "AAAA" }); });
      finish();
      jest.advanceTimersByTime(301);
      await act(async () => {
        await oldRecorder.onAudioAnalysis({ dataPoints: [{ silent: false, rms: 0.8 }] });
        await oldRecorder.onAudioStream({ data: "AAAA" });
        await recorder.onAudioAnalysis({ dataPoints: [{ silent: false, rms: 0.1 }] });
        await recorder.onAudioStream({ data: "AAAA" });
        await recorder.onAudioStream({ data: "AAAA" });
        jest.advanceTimersByTime(300);
        await recorder.onAudioAnalysis({ dataPoints: [{ silent: true, rms: 0 }] });
        jest.advanceTimersByTime(650);
      });
      expect(realtimeVoiceApi.audioChunk).toHaveBeenCalledTimes(1);
      expect(realtimeVoiceApi.turn).toHaveBeenCalledTimes(1);
      expect(options.onBargeIn).not.toHaveBeenCalled();
    } finally { await act(async () => { await voice.stop(); }); jest.setSystemTime(0); beginVoiceOutput(true)(); jest.useRealTimers(); }
  });

  it("does not cancel a processing turn on unverified native RMS input", async () => {
    jest.useFakeTimers();
    try {
      let resolve!: (value: never) => void;
      jest.mocked(realtimeVoiceApi.audioChunk).mockReturnValueOnce(new Promise(done => { resolve = done; }));
      jest.mocked(realtimeVoiceApi.turn).mockResolvedValue({ intent: "control", action: { action: "NEXT_STEP" } } as never);
      await act(async () => { await voice.start(); });
      const recorder = mockStartNativeRecording.mock.calls[0][0];
      await act(async () => {
        await recorder.onAudioAnalysis({ dataPoints: [{ silent: false, rms: 0.1 }] });
        await recorder.onAudioStream({ data: "AAAA" });
        await recorder.onAudioStream({ data: "AAAA" });
        jest.advanceTimersByTime(300);
        await recorder.onAudioAnalysis({ dataPoints: [{ silent: true, rms: 0 }] });
        jest.advanceTimersByTime(650);
      });
      expect(voice.state).toBe("processing");
      await act(async () => {
        await recorder.onAudioAnalysis({ dataPoints: [{ silent: false, rms: 0.8 }] });
        await recorder.onAudioStream({ data: "AAAA" });
        resolve({ transcript: "下一步" } as never);
      });
      expect(options.onBargeIn).not.toHaveBeenCalled();
      expect(options.onControl).toHaveBeenCalledWith("NEXT_STEP", 0);
      expect(voice.state).toBe("listening");
    } finally { await act(async () => { await voice.stop(); }); jest.useRealTimers(); }
  });

  it("closes the remote session and resets local state when microphone permission is denied", async () => {
    jest.mocked(Audio.requestPermissionsAsync).mockResolvedValue({ granted: false } as never);
    let started = true;

    await act(async () => { started = await voice.start(); });

    expect(started).toBe(false);
    expect(realtimeVoiceApi.close).toHaveBeenCalledWith(expect.any(Function), createdSession.id);
    expect(mockStopNativeRecording).not.toHaveBeenCalled();
    expect(voice.session).toBeNull();
    expect(voice.active).toBe(false);
    expect(voice.state).toBe("fallback");
  });

  it("closes a late created session without starting recording after stop", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof realtimeVoiceApi.create>>) => void;
    jest.mocked(realtimeVoiceApi.create).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.start(); });
    await act(async () => { expect(await voice.start()).toBe(false); await voice.stop(); });
    await act(async () => { resolve({ session: createdSession, repeated: false }); expect(await pending).toBe(false); });
    expect(mockStartNativeRecording).not.toHaveBeenCalled();
    expect(realtimeVoiceApi.close).toHaveBeenCalledWith(mockAuthFetch, createdSession.id);
    expect(voice.state).toBe("off");
  });

  it("does not start the microphone after delayed permission resolves on an exited page", async () => {
    let resolve!: (value: never) => void;
    jest.mocked(Audio.requestPermissionsAsync).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.start(); });
    await act(async () => { await voice.stop(); });
    await act(async () => { resolve({ granted: true } as never); await pending; });
    expect(mockStartNativeRecording).not.toHaveBeenCalled();
    expect(voice.state).toBe("off");
  });

  it("stops a native recorder that finishes starting after the page exits", async () => {
    let recording = false;
    let release!: () => void;
    mockStartNativeRecording.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      recording = true;
    });
    mockStopNativeRecording.mockImplementation(async () => { recording = false; });
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.start(); });
    let stopping!: Promise<void>;
    await act(async () => { stopping = voice.stop(); });
    await act(async () => { release(); expect(await pending).toBe(false); await stopping; });
    expect(recording).toBe(false);
    expect(voice.state).toBe("off");
  });

  it("invalidates pending startup when the app backgrounds", async () => {
    let onChange!: (state: "background") => void;
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
      onChange = listener;
      return { remove: jest.fn() };
    });
    await act(async () => { tree.unmount(); tree = renderer.create(<Harness onUpdate={value => { voice = value; }} />); });
    let resolve!: (value: Awaited<ReturnType<typeof realtimeVoiceApi.create>>) => void;
    jest.mocked(realtimeVoiceApi.create).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.start(); onChange("background"); });
    await act(async () => { resolve({ session: createdSession, repeated: false }); await pending; });
    expect(mockStartNativeRecording).not.toHaveBeenCalled();
    expect(voice.state).toBe("off");
    spy.mockReturnValue({ remove: jest.fn() });
  });

  it("does not upload fallback audio when a pending transcription fails after mute", async () => {
    jest.useFakeTimers();
    try {
      let reject!: (error: Error) => void;
      jest.mocked(realtimeVoiceApi.audioChunk).mockReturnValueOnce(new Promise((_done, fail) => { reject = fail; }));
      await act(async () => { await voice.start(); });
      const recorder = mockStartNativeRecording.mock.calls[0][0];
      await act(async () => {
        await recorder.onAudioAnalysis({ dataPoints: [{ silent: false, rms: 0.1 }] });
        await recorder.onAudioStream({ data: "AAAA" });
        await recorder.onAudioStream({ data: "AAAA" });
        jest.advanceTimersByTime(300);
        await recorder.onAudioAnalysis({ dataPoints: [{ silent: true, rms: 0 }] });
        jest.advanceTimersByTime(650);
      });
      expect(realtimeVoiceApi.audioChunk).toHaveBeenCalled();
      await act(async () => { await voice.toggleMute(); reject(new Error("offline")); });
      expect(aiApi.transcribe).not.toHaveBeenCalled();
      expect(realtimeVoiceApi.turn).not.toHaveBeenCalled();
      expect(voice.state).toBe("muted");
    } finally { await act(async () => { await voice.stop(); }); jest.setSystemTime(0); beginVoiceOutput(true)(); jest.useRealTimers(); }
  });

  it("ignores recorder interruption callbacks from a closed session", async () => {
    await act(async () => { await voice.start(); });
    const oldRecorder = mockStartNativeRecording.mock.calls[0][0];
    await act(async () => { await voice.stop(); await voice.start(); });
    const stops = mockStopNativeRecording.mock.calls.length;
    await act(async () => { oldRecorder.onRecordingInterrupted(); });
    expect(mockStopNativeRecording).toHaveBeenCalledTimes(stops);
    expect(voice.state).toBe("listening");
  });

  it("stops capture when Web microphone permission is revoked", async () => {
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    const recognizers: Array<{ onerror?: (event: { error: string }) => void }> = [];
    let recording = false;
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: class {
      constructor() { recognizers.push(this); }
      onerror?: (event: { error: string }) => void;
      start() { recording = true; }
      abort() { recording = false; }
    } });
    try {
      await act(async () => { await voice.start(); });
      await act(async () => { recognizers[0].onerror!({ error: "not-allowed" }); });
      expect(recording).toBe(false);
      expect(voice.state).toBe("off");
      expect(options.onStopOutput).toHaveBeenCalled();
    } finally { Reflect.deleteProperty(window, "SpeechRecognition"); }
  });

  it("closes the remote session and releases partial recording state when native startup fails", async () => {
    jest.mocked(Audio.requestPermissionsAsync).mockResolvedValue({ granted: true } as never);
    mockStartNativeRecording.mockRejectedValue(new Error("native recorder failed"));
    let started = true;

    await act(async () => { started = await voice.start(); });

    expect(started).toBe(false);
    expect(realtimeVoiceApi.close).toHaveBeenCalledWith(expect.any(Function), createdSession.id);
    expect(mockStopNativeRecording).toHaveBeenCalled();
    expect(voice.session).toBeNull();
    expect(voice.state).toBe("fallback");
    expect(options.onError).toHaveBeenCalledWith("native recorder failed");
  });
  it("pauses the native microphone immediately even while the heartbeat hangs or fails", async () => {
    let recording = false;
    mockStartNativeRecording.mockImplementation(async () => { recording = true; });
    mockPauseNativeRecording.mockImplementation(async () => { recording = false; });
    await act(async () => { await voice.start(); });
    expect(recording).toBe(true);
    let reject!: (error: Error) => void;
    jest.mocked(realtimeVoiceApi.heartbeat).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.toggleMute(); });
    expect(recording).toBe(false);
    expect(voice.muted).toBe(true);
    expect(options.onStopOutput).toHaveBeenCalled();
    await act(async () => { reject(new Error("offline")); await pending; });
    expect(recording).toBe(false);
    expect(voice.muted).toBe(true);
  });

  it("coalesces rapid Web resume taps and never restarts after stop", async () => {
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    let recording = false;
    const start = jest.fn(() => { if (recording) throw new Error("already started"); recording = true; });
    const abort = jest.fn(() => { recording = false; });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: class {
      start = start;
      abort = abort;
    } });
    try {
      await act(async () => { await voice.start(); await voice.toggleMute(); });
      expect(recording).toBe(false);
      let resolve!: (value: Awaited<ReturnType<typeof realtimeVoiceApi.heartbeat>>) => void;
      jest.mocked(realtimeVoiceApi.heartbeat).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
      let first!: Promise<boolean>;
      await act(async () => { first = voice.toggleMute(); await voice.toggleMute(); });
      await act(async () => { resolve({ session: { ...createdSession, version: 3 } }); await first; });
      expect(recording).toBe(true);
      expect(voice.muted).toBe(false);
      expect(start).toHaveBeenCalledTimes(2);
      await act(async () => { await voice.toggleMute(); });
      jest.mocked(realtimeVoiceApi.heartbeat).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
      await act(async () => { first = voice.toggleMute(); });
      await act(async () => { await voice.stop(); });
      await act(async () => { resolve({ session: { ...createdSession, version: 5 } }); await first; });
      expect(recording).toBe(false);
      expect(voice.state).toBe("off");
      expect(start).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(window, "SpeechRecognition");
    }
  });

  it("stops a partially resumed native recorder if resume throws", async () => {
    let recording = false;
    mockStartNativeRecording.mockImplementation(async () => { recording = true; });
    mockPauseNativeRecording.mockImplementation(async () => { recording = false; });
    mockResumeNativeRecording.mockImplementation(async () => { recording = true; throw new Error("resume failed"); });
    await act(async () => { await voice.start(); await voice.toggleMute(); });
    await act(async () => { await voice.toggleMute(); });
    expect(recording).toBe(false);
    expect(voice.muted).toBe(true);
  });

  function networkChange(network: Network.NetworkState) {
    const listener = jest.mocked(Network.addNetworkStateListener).mock.calls.at(-1)![0];
    listener(network);
  }

  async function utterance() {
    const recorder = mockStartNativeRecording.mock.calls.at(-1)![0];
    await recorder.onAudioAnalysis({ dataPoints: [{ silent: false, rms: 0.1 }] });
    await recorder.onAudioStream({ data: "AAAA" });
    await recorder.onAudioStream({ data: "AAAA" });
    jest.advanceTimersByTime(300);
    await recorder.onAudioAnalysis({ dataPoints: [{ silent: true, rms: 0 }] });
    jest.advanceTimersByTime(650);
  }

  it("stops locally on a transport heartbeat failure before best-effort close settles", async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(realtimeVoiceApi.heartbeat).mockRejectedValueOnce(new ApiTransportError("offline", null));
      jest.mocked(realtimeVoiceApi.close).mockReturnValueOnce(new Promise(() => { /* Remote close may remain unavailable. */ }));
      await act(async () => { await voice.start(); });
      await act(async () => { jest.advanceTimersByTime(20_000); });
      expect(mockStopNativeRecording).toHaveBeenCalledTimes(1);
      expect(options.onStopOutput).toHaveBeenCalledTimes(1);
      expect(voice.active).toBe(false);
      expect(voice.session).toBeNull();
      await act(async () => { networkChange({ isConnected: true }); jest.advanceTimersByTime(60_000); await voice.stop(); });
      expect(mockStartNativeRecording).toHaveBeenCalledTimes(1);
      expect(mockStopNativeRecording).toHaveBeenCalledTimes(1);
      expect(realtimeVoiceApi.close).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it.each([401, 403, 404, 410])("stops on invalid session HTTP %s without claiming network loss", async status => {
    jest.useFakeTimers();
    try {
      jest.mocked(realtimeVoiceApi.heartbeat).mockRejectedValueOnce(new ApiError("expired", status));
      await act(async () => { await voice.start(); });
      await act(async () => { jest.advanceTimersByTime(20_000); });
      expect(voice.active).toBe(false);
      expect(options.onError).toHaveBeenCalledWith(expect.stringContaining("会话已失效"));
    } finally { jest.useRealTimers(); }
  });

  it.each([503, 409, 0])("does not classify HTTP/schema error %s as offline", async status => {
    jest.useFakeTimers();
    try {
      jest.mocked(realtimeVoiceApi.heartbeat).mockRejectedValueOnce(new ApiError("provider or schema failure", status));
      await act(async () => { await voice.start(); });
      await act(async () => { jest.advanceTimersByTime(20_000); });
      expect(voice.state).toBe("listening");
      expect(mockStopNativeRecording).not.toHaveBeenCalled();
      expect(options.onError).toHaveBeenCalledWith("provider or schema failure");
    } finally { await act(async () => { await voice.stop(); }); jest.useRealTimers(); }
  });

  it.each(["resolve", "reject"])("discards pending ASR on network loss (%s), never uploading fallback audio", async result => {
    jest.useFakeTimers();
    try {
      let resolve!: (value: never) => void;
      let reject!: (error: Error) => void;
      jest.mocked(realtimeVoiceApi.audioChunk).mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
      await act(async () => { await voice.start(); });
      await act(utterance);
      await act(async () => { networkChange({ isInternetReachable: false }); });
      await act(async () => { if (result === "resolve") resolve({ transcript: "下一步" } as never); else reject(new Error("offline")); });
      expect(options.onTranscript).not.toHaveBeenCalled();
      expect(realtimeVoiceApi.turn).not.toHaveBeenCalled();
      expect(aiApi.transcribe).not.toHaveBeenCalled();
      expect(voice.active).toBe(false);
    } finally { jest.useRealTimers(); }
  });

  it("halts on ASR transport failure instead of trying fallback", async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(realtimeVoiceApi.audioChunk).mockRejectedValueOnce(new ApiTransportError("offline", null));
      await act(async () => { await voice.start(); });
      await act(utterance);
      expect(aiApi.transcribe).not.toHaveBeenCalled();
      expect(mockStopNativeRecording).toHaveBeenCalledTimes(1);
      expect(voice.active).toBe(false);
    } finally { jest.useRealTimers(); }
  });

  it("ignores unknown reachability but cancels startup on explicit offline and allows only manual restart", async () => {
    let resolve!: (value: never) => void;
    jest.mocked(Audio.requestPermissionsAsync).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.start(); });
    await act(async () => { networkChange({}); });
    expect(voice.state).toBe("connecting");
    await act(async () => { networkChange({ isConnected: false }); });
    await act(async () => { resolve({ granted: true } as never); expect(await pending).toBe(false); networkChange({ isConnected: true }); });
    expect(mockStartNativeRecording).not.toHaveBeenCalled();
    await act(async () => { expect(await voice.start()).toBe(true); });
    expect(mockStartNativeRecording).toHaveBeenCalledTimes(1);
  });

  it.each(["turn", "events"])("discards pending %s responses and stops output on network loss", async phase => {
    jest.useFakeTimers();
    try {
      let resolve!: (value: never) => void;
      jest.mocked(realtimeVoiceApi.audioChunk).mockResolvedValue({ transcript: "下一步" } as never);
      jest.mocked(realtimeVoiceApi.turn).mockResolvedValue({ intent: "answer", turnId: "turn" } as never);
      jest.mocked(realtimeVoiceApi[phase as "turn" | "events"]).mockReturnValueOnce(new Promise(done => { resolve = done; }));
      await act(async () => { await voice.start(); });
      await act(utterance);
      await act(async () => { networkChange({ isConnected: false }); });
      await act(async () => { resolve((phase === "turn"
        ? { intent: "control", action: { action: "NEXT_STEP" } }
        : { events: [{ sequence: 1, type: "response.text.delta", payload: { turnId: "turn", delta: "text" } }, { sequence: 2, type: "response.completed", payload: { turnId: "turn", text: "text" } }] }) as never); });
      expect(options.onControl).not.toHaveBeenCalled();
      expect(options.onAnswerDelta).not.toHaveBeenCalled();
      expect(options.onAnswer).not.toHaveBeenCalled();
      expect(options.onStopOutput).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it("never restarts Web recognition after a network error or offline event", async () => {
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    const start = jest.fn(); const abort = jest.fn();
    const recognitions: any[] = [];
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: class {
      constructor() { recognitions.push(this); }
      start = start; abort = abort;
    } });
    jest.useFakeTimers();
    try {
      await act(async () => { tree.unmount(); tree = renderer.create(<Harness onUpdate={value => { voice = value; }} />); });
      await act(async () => { await voice.start(); });
      await act(async () => { recognitions.at(-1).onerror({ error: "network" }); recognitions.at(-1).onend();  jest.advanceTimersByTime(1000); });
      expect(start).toHaveBeenCalledTimes(1);
      expect(abort).toHaveBeenCalledTimes(1);
      await act(async () => { await voice.start(); (jest.mocked(window.addEventListener).mock.calls.find(([event]) => event === "offline")![1] as () => void)(); recognitions.at(-1).onend(); jest.advanceTimersByTime(1000); });
      expect(start).toHaveBeenCalledTimes(2);
      expect(abort).toHaveBeenCalledTimes(2);
      expect(voice.active).toBe(false);
    } finally { Reflect.deleteProperty(window, "SpeechRecognition"); jest.useRealTimers(); }
  });

  it("discards partial ASR and buffered audio, with no stale flush after a manual restart", async () => {
    jest.useFakeTimers();
    try {
      let resolve!: (value: never) => void;
      jest.mocked(realtimeVoiceApi.audioChunk).mockReturnValueOnce(new Promise(done => { resolve = done; }));
      await act(async () => { await voice.start(); });
      const recorder = mockStartNativeRecording.mock.calls.at(-1)![0];
      await act(async () => {
        await recorder.onAudioAnalysis({ dataPoints: [{ silent: false, rms: 0.1 }] });
        for (let i = 0; i < 10; i++) await recorder.onAudioStream({ data: "AAAA" });
        await recorder.onAudioAnalysis({ dataPoints: [{ silent: true, rms: 0 }] });
        networkChange({ isConnected: false });
      });
      await act(async () => { await voice.start(); resolve({ transcript: "stale" } as never); jest.advanceTimersByTime(1000); });
      expect(options.onTranscript).not.toHaveBeenCalled();
      expect(realtimeVoiceApi.audioChunk).toHaveBeenCalledTimes(1);
      expect(realtimeVoiceApi.turn).not.toHaveBeenCalled();
      expect(voice.state).toBe("listening");
    } finally { await act(async () => { await voice.stop(); }); jest.useRealTimers(); }
  });

  it("warns if native stop fails rather than claiming the microphone is closed", async () => {
    await act(async () => { await voice.start(); });
    mockStopNativeRecording.mockRejectedValueOnce(new Error("stop failed"));
    await act(async () => { networkChange({ isConnected: false }); });
    expect(options.onError).toHaveBeenCalledWith(expect.stringContaining("无法确认麦克风已关闭"));
    expect(voice.active).toBe(false);
    expect(realtimeVoiceApi.close).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes from network changes on unmount", async () => {
    const subscription = jest.mocked(Network.addNetworkStateListener).mock.results.at(-1)!.value;
    await act(async () => { tree.unmount(); });
    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });

  it("serializes a pending native resume against manual restart after offline", async () => {
    let recording = false;
    let resolveResume!: () => void;
    mockStartNativeRecording.mockImplementation(async () => { recording = true; });
    mockStopNativeRecording.mockImplementation(async () => { recording = false; });
    mockPauseNativeRecording.mockImplementation(async () => { recording = false; });
    mockResumeNativeRecording.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { resolveResume = resolve; });
      recording = true;
    });
    await act(async () => { await voice.start(); await voice.toggleMute(); });
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.toggleMute(); });
    await act(async () => { networkChange({ isConnected: false }); });
    await act(async () => { expect(await voice.start()).toBe(false); });
    expect(recording).toBe(false);
    await act(async () => { resolveResume(); await pending; });
    expect(recording).toBe(false);
    await act(async () => { expect(await voice.start()).toBe(true); });
    expect(recording).toBe(true);
    expect(voice.state).toBe("listening");
    expect(mockStartNativeRecording).toHaveBeenCalledTimes(2);
  });

});
