import React from "react";
import renderer, { act } from "react-test-renderer";
import { Alert, AppState, Linking, Platform } from "react-native";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { aiApi, waitForAgentRun } from "@/services/api";
import { useVoiceRecorder } from "./useVoiceRecorder";

const mockAuthFetch = jest.fn();
const mockPrepareRecording = jest.fn();
const mockStartRecording = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({
  useAuthFetch: () => mockAuthFetch,
}));

jest.mock("expo-av", () => ({
  Audio: {
    requestPermissionsAsync: jest.fn(),
    setAudioModeAsync: jest.fn(),
    Recording: jest.fn().mockImplementation(() => {
      let delegate: any;
      return {
        prepareToRecordAsync: async () => { delegate = (await mockPrepareRecording()).recording; },
        startAsync: () => mockStartRecording(),
        stopAndUnloadAsync: () => delegate.stopAndUnloadAsync(),
        getURI: () => delegate.getURI(),
      };
    }),
    RecordingOptionsPresets: {
      HIGH_QUALITY: {},
    },
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: jest.fn(),
}));

jest.mock("@/services/api", () => ({
  aiApi: {
    transcribe: jest.fn(),
  },
  waitForAgentRun: jest.fn(),
}));

describe("useVoiceRecorder", () => {
  let recorderHook!: ReturnType<typeof useVoiceRecorder>;
  const onSpeechResult = jest.fn();
  const onSpeechFinal = jest.fn();
  const onSpeechEmpty = jest.fn();

  function TestComponent({ scopeKey, focused }: { scopeKey?: string; focused?: boolean } = {}) {
    const value = useVoiceRecorder({ scopeKey, focused, onSpeechResult, onSpeechFinal, onSpeechEmpty });
    React.useLayoutEffect(() => {
      recorderHook = value;
    });
    return null;
  }

  let tree: renderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStartRecording.mockReset().mockResolvedValue(undefined);
    Platform.OS = "ios";
    jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined as never);
    jest.spyOn(console, "error").mockImplementation(jest.fn());
  });

  afterEach(async () => {
    if (tree) {
      await act(async () => {
        tree!.unmount();
      });
      tree = null;
    }
  });

  test("handles permission rejection and prompts user appropriately", async () => {
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
    });

    await act(async () => {
      tree = renderer.create(<TestComponent />);
    });

    await act(async () => {
      await recorderHook.startRecording();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "需要麦克风权限",
      "请允许食光烙记使用麦克风后再试。",
      expect.any(Array),
    );
    expect(recorderHook.isRecording).toBe(false);

    // Test permanent rejection (canAskAgain = false)
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
    });

    await act(async () => {
      await recorderHook.startRecording();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "需要麦克风权限",
      "麦克风权限已被关闭，请前往系统设置为食光烙记开启权限。",
      expect.any(Array),
    );

    // Trigger settings button
    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const settingsButton = alertCalls[alertCalls.length - 1][2][1];
    expect(settingsButton.text).toBe("打开设置");
    settingsButton.onPress();
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  test("records native audio and transcribes result successfully", async () => {
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);

    const mockRecording = {
      stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
      getURI: jest.fn().mockReturnValue("file:///test-audio.m4a"),
    };
    (mockPrepareRecording as jest.Mock).mockResolvedValueOnce({ recording: mockRecording });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce("mock-base64-audio");
    (aiApi.transcribe as jest.Mock).mockResolvedValueOnce({
      text: "买两斤西兰花",
      run: { id: "run-1", status: "completed" },
    });
    (waitForAgentRun as jest.Mock).mockResolvedValueOnce({
      id: "run-1",
      status: "completed",
      transcript: "买两斤西兰花",
    });

    await act(async () => {
      tree = renderer.create(<TestComponent />);
    });

    await act(async () => {
      await recorderHook.startRecording();
    });

    expect(recorderHook.isRecording).toBe(true);
    expect(Audio.setAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsRecordingIOS: true }),
    );

    await act(async () => {
      recorderHook.stopRecording();
    });

    expect(mockRecording.stopAndUnloadAsync).toHaveBeenCalled();
    expect(aiApi.transcribe).toHaveBeenCalledWith(mockAuthFetch, "mock-base64-audio", "audio/m4a");
    expect(onSpeechResult).toHaveBeenCalledWith("买两斤西兰花");
    expect(onSpeechFinal).toHaveBeenCalledWith("买两斤西兰花");
    expect(recorderHook.isRecording).toBe(false);
    expect(recorderHook.isTranscribing).toBe(false);
    // Verified audio mode reset
    expect(Audio.setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });
  });

  test("network disconnect or transcribe failure resets recording state and avoids hung recorder (#183)", async () => {
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);

    const mockRecording = {
      stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
      getURI: jest.fn().mockReturnValue("file:///test-audio.m4a"),
    };
    (mockPrepareRecording as jest.Mock).mockResolvedValueOnce({ recording: mockRecording });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce("mock-base64-audio");
    // Simulate network error / connection drop during transcribe
    (aiApi.transcribe as jest.Mock).mockRejectedValueOnce(new Error("Network request failed"));

    await act(async () => {
      tree = renderer.create(<TestComponent />);
    });

    await act(async () => {
      await recorderHook.startRecording();
    });
    expect(recorderHook.isRecording).toBe(true);

    await act(async () => {
      recorderHook.stopRecording();
    });

    // Verify recording was properly unloaded and state reset
    expect(mockRecording.stopAndUnloadAsync).toHaveBeenCalled();
    expect(onSpeechEmpty).toHaveBeenCalled();
    expect(onSpeechFinal).not.toHaveBeenCalled();
    expect(recorderHook.isRecording).toBe(false);
    expect(recorderHook.isTranscribing).toBe(false);
    expect(recorderHook.statusText).toBe("");
    expect(Audio.setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });
  });

  test("component unmount stops active native recording and prevents late callbacks (#183)", async () => {
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);

    const mockRecording = {
      stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
      getURI: jest.fn().mockReturnValue("file:///test-audio.m4a"),
    };
    (mockPrepareRecording as jest.Mock).mockResolvedValueOnce({ recording: mockRecording });

    await act(async () => {
      tree = renderer.create(<TestComponent />);
    });

    await act(async () => {
      await recorderHook.startRecording();
    });
    expect(recorderHook.isRecording).toBe(true);

    // Unmount while recording is running
    await act(async () => {
      tree!.unmount();
      tree = null;
    });

    expect(mockRecording.stopAndUnloadAsync).toHaveBeenCalled();
    expect(onSpeechFinal).not.toHaveBeenCalled();
  });
  test.each(["conversation-B", "account-B", "logged-out"])("discards pending native ASR after scope becomes %s", async nextScope => {
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
    const recording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: () => "file:///old.m4a" };
    (mockPrepareRecording as jest.Mock).mockResolvedValue({ recording });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue("audio");
    let resolve!: (value: unknown) => void;
    (aiApi.transcribe as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
    await act(async () => { tree = renderer.create(<TestComponent scopeKey="account-A:conversation-A" />); });
    await act(async () => { await recorderHook.startRecording(); recorderHook.stopRecording(); });
    expect(aiApi.transcribe).toHaveBeenCalledTimes(1);
    await act(async () => { tree!.update(<TestComponent scopeKey={nextScope} />); });
    await act(async () => { resolve({ text: "旧账号秘密", run: { id: "old", status: "completed" } }); });
    expect(waitForAgentRun).not.toHaveBeenCalled();
    expect(onSpeechResult).not.toHaveBeenCalled();
    expect(onSpeechFinal).not.toHaveBeenCalled();
    expect(onSpeechEmpty).not.toHaveBeenCalled();
    expect(recorderHook.isTranscribing).toBe(false);
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  }

  test.each(["permissions", "audio mode", "creation", "start"])("stop cancels native startup during %s", async stage => {
    const pending = deferred<any>();
    const recording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: jest.fn() };
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
    (mockPrepareRecording as jest.Mock).mockResolvedValue({ recording });
    const operation = stage === "permissions" ? Audio.requestPermissionsAsync
      : stage === "audio mode" ? Audio.setAudioModeAsync : stage === "start" ? mockStartRecording : mockPrepareRecording;
    (operation as jest.Mock).mockReturnValueOnce(pending.promise);
    await act(async () => { tree = renderer.create(<TestComponent scopeKey="A" />); });
    let start!: Promise<void>;
    await act(async () => { start = recorderHook.startRecording(); });
    act(() => { recorderHook.stopRecording(); });
    expect(recorderHook.isRecording).toBe(false);
    expect(recorderHook.statusText).toBe("");
    await act(async () => {
      pending.resolve(stage === "permissions" ? { granted: true } : stage === "creation" ? { recording } : undefined);
      await start;
    });
    if (stage === "creation" || stage === "start") expect(recording.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
    else expect(mockPrepareRecording).not.toHaveBeenCalled();
    expect(aiApi.transcribe).not.toHaveBeenCalled();
    expect(onSpeechFinal).not.toHaveBeenCalled();
    expect(recorderHook.isRecording).toBe(false);
  });

  test.each(["same scope", "changed scope", "new mount"])("native singleton waits for cancelled creation and cleanup before restarting: %s", async transition => {
    const pending = deferred<any>();
    const unloaded = deferred<void>();
    const modeReset = deferred<void>();
    let hardwareOwner = "none";
    const oldRecording = { stopAndUnloadAsync: jest.fn(async () => {
      await unloaded.promise;
      hardwareOwner = "none";
    }), getURI: jest.fn() };
    const newRecording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: jest.fn() };
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockImplementation(async options => {
      if (!options.allowsRecordingIOS) await modeReset.promise;
    });
    (mockPrepareRecording as jest.Mock).mockReturnValueOnce(pending.promise).mockImplementationOnce(async () => {
      expect(hardwareOwner).toBe("none");
      hardwareOwner = "new";
      return { recording: newRecording };
    });
    await act(async () => { tree = renderer.create(<TestComponent scopeKey="A" />); });
    let start!: Promise<void>;
    await act(async () => { start = recorderHook.startRecording(); });
    await act(async () => {
      if (transition === "same scope") recorderHook.stopRecording();
      else if (transition === "changed scope") tree!.update(<TestComponent scopeKey="B" />);
      else { tree!.unmount(); tree = null; }
    });
    if (transition === "new mount") await act(async () => { tree = renderer.create(<TestComponent scopeKey="A" />); });
    let nextStart!: Promise<void>;
    await act(async () => { nextStart = recorderHook.startRecording(); });
    expect(mockPrepareRecording).toHaveBeenCalledTimes(1);
    await act(async () => {
      hardwareOwner = "old";
      pending.resolve({ recording: oldRecording });
    });
    expect(oldRecording.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
    expect(mockPrepareRecording).toHaveBeenCalledTimes(1);
    await act(async () => { unloaded.resolve(); });
    expect(mockPrepareRecording).toHaveBeenCalledTimes(1);
    await act(async () => { modeReset.resolve(); await start; await nextStart; });
    expect(mockPrepareRecording).toHaveBeenCalledTimes(2);
    expect(hardwareOwner).toBe("new");
    expect(newRecording.stopAndUnloadAsync).not.toHaveBeenCalled();
    expect(recorderHook.isRecording).toBe(true);
    await act(async () => { tree!.unmount(); tree = null; });
    expect(newRecording.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
  });

  test("another hook cannot interrupt the native owner, and a cancelled waiter never creates audio", async () => {
    const unloaded = deferred<void>();
    const recording = { stopAndUnloadAsync: jest.fn(() => unloaded.promise), getURI: jest.fn() };
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
    (mockPrepareRecording as jest.Mock).mockResolvedValue({ recording });
    await act(async () => { tree = renderer.create(<TestComponent scopeKey="owner" />); });
    await act(async () => { await recorderHook.startRecording(); });
    let secondTree!: renderer.ReactTestRenderer;
    await act(async () => { secondTree = renderer.create(<TestComponent scopeKey="waiter" />); });
    let waiting!: Promise<void>;
    await act(async () => { waiting = recorderHook.startRecording(); });
    expect(recording.stopAndUnloadAsync).not.toHaveBeenCalled();
    expect(mockPrepareRecording).toHaveBeenCalledTimes(1);
    act(() => { recorderHook.stopRecording(); });
    await act(async () => { tree!.unmount(); tree = null; });
    expect(recording.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
    expect(mockPrepareRecording).toHaveBeenCalledTimes(1);
    await act(async () => { unloaded.resolve(); await waiting; });
    expect(mockPrepareRecording).toHaveBeenCalledTimes(1);
    expect(recorderHook.isRecording).toBe(false);
    await act(async () => { secondTree.unmount(); });
  });

  test("failed native start completes global unload before a second hook can prepare", async () => {
    const unloaded = deferred<void>();
    const oldRecording = { stopAndUnloadAsync: jest.fn(() => unloaded.promise), getURI: jest.fn() };
    const newRecording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: jest.fn() };
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
    mockPrepareRecording.mockResolvedValueOnce({ recording: oldRecording }).mockResolvedValueOnce({ recording: newRecording });
    mockStartRecording.mockRejectedValueOnce(new Error("native start failed"));
    await act(async () => { tree = renderer.create(<TestComponent scopeKey="old" />); });
    let failedStart!: Promise<void>;
    await act(async () => { failedStart = recorderHook.startRecording(); });
    expect(oldRecording.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
    let secondTree!: renderer.ReactTestRenderer;
    await act(async () => { secondTree = renderer.create(<TestComponent scopeKey="new" />); });
    let nextStart!: Promise<void>;
    await act(async () => { nextStart = recorderHook.startRecording(); });
    expect(mockPrepareRecording).toHaveBeenCalledTimes(1);
    await act(async () => { unloaded.resolve(); await failedStart; await nextStart; });
    expect(mockPrepareRecording).toHaveBeenCalledTimes(2);
    expect(newRecording.stopAndUnloadAsync).not.toHaveBeenCalled();
    expect(recorderHook.isRecording).toBe(true);
    await act(async () => { secondTree.unmount(); });
  });

  test("failed native preparation releases its lease without unloading an unprepared recorder", async () => {
    const recording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: jest.fn() };
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
    mockPrepareRecording.mockRejectedValueOnce(new Error("prepare failed")).mockResolvedValueOnce({ recording });
    await act(async () => { tree = renderer.create(<TestComponent />); });
    await act(async () => { await recorderHook.startRecording(); });
    expect(recorderHook.isRecording).toBe(false);
    expect(mockStartRecording).not.toHaveBeenCalled();
    await act(async () => { await recorderHook.startRecording(); });
    expect(recorderHook.isRecording).toBe(true);
    expect(mockStartRecording).toHaveBeenCalledTimes(1);
    expect(recording.stopAndUnloadAsync).not.toHaveBeenCalled();
  });

  test("old transcription cannot emit or reset a new recording in the same scope", async () => {
    const pending = deferred<any>();
    const oldRecording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: () => "old.m4a" };
    const newRecording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: jest.fn() };
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
    (mockPrepareRecording as jest.Mock).mockResolvedValueOnce({ recording: oldRecording }).mockResolvedValueOnce({ recording: newRecording });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue("audio");
    (aiApi.transcribe as jest.Mock).mockReturnValueOnce(pending.promise);
    await act(async () => { tree = renderer.create(<TestComponent />); });
    await act(async () => { await recorderHook.startRecording(); recorderHook.stopRecording(); });
    await act(async () => { await recorderHook.startRecording(); });
    const modeCalls = (Audio.setAudioModeAsync as jest.Mock).mock.calls.length;
    await act(async () => { pending.resolve({ text: "stale", run: { id: "old", status: "completed" } }); });
    expect(waitForAgentRun).not.toHaveBeenCalled();
    expect(onSpeechResult).not.toHaveBeenCalled();
    expect(onSpeechFinal).not.toHaveBeenCalled();
    expect(onSpeechEmpty).not.toHaveBeenCalled();
    expect(recorderHook.isRecording).toBe(true);
    expect(Audio.setAudioModeAsync).toHaveBeenCalledTimes(modeCalls);
    act(() => { tree!.unmount(); tree = null; });
    expect(newRecording.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
  });

  test("scope A-B-A does not revive pending startup or stale controls", async () => {
    const pending = deferred<any>();
    const recording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: jest.fn() };
    (Audio.requestPermissionsAsync as jest.Mock).mockReturnValueOnce(pending.promise).mockResolvedValue({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
    (mockPrepareRecording as jest.Mock).mockResolvedValue({ recording });
    await act(async () => { tree = renderer.create(<TestComponent scopeKey="A" />); });
    const staleControls = recorderHook;
    let start!: Promise<void>;
    await act(async () => { start = recorderHook.startRecording(); });
    await act(async () => { tree!.update(<TestComponent scopeKey="B" />); });
    await act(async () => { tree!.update(<TestComponent scopeKey="A" />); });
    await act(async () => { await recorderHook.startRecording(); });
    await act(async () => {
      staleControls.stopRecording();
      await staleControls.startRecording();
      pending.resolve({ granted: true });
      await start;
    });
    expect(mockPrepareRecording).toHaveBeenCalledTimes(1);
    expect(recording.stopAndUnloadAsync).not.toHaveBeenCalled();
    expect(recorderHook.isRecording).toBe(true);
  });

  test("cancelled permission rejection does not show a stale alert", async () => {
    const pending = deferred<any>();
    (Audio.requestPermissionsAsync as jest.Mock).mockReturnValueOnce(pending.promise);
    await act(async () => { tree = renderer.create(<TestComponent />); });
    let start!: Promise<void>;
    await act(async () => { start = recorderHook.startRecording(); });
    act(() => { recorderHook.stopRecording(); });
    await act(async () => { pending.reject(new Error("cancelled")); await start; });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(onSpeechEmpty).not.toHaveBeenCalled();
  });

  test.each(["stop", "discard", "blur", "background"])("%s while web microphone permission is pending releases the late stream", async reason => {
    Platform.OS = "web";
    const pending = deferred<any>();
    const stop = jest.fn();
    const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: jest.fn(() => pending.promise) } } });
    try {
      await act(async () => { tree = renderer.create(<TestComponent />); });
      let start!: Promise<void>;
      await act(async () => { start = recorderHook.startRecording(); });
      act(() => {
        if (reason === "blur") tree!.update(<TestComponent focused={false} />);
        else if (reason === "background") jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1]("background");
        else if (reason === "discard") recorderHook.discardRecording();
        else recorderHook.stopRecording();
      });
      await act(async () => { pending.resolve({ getTracks: () => [{ stop }] }); await start; });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(aiApi.transcribe).not.toHaveBeenCalled();
      expect(recorderHook.isRecording).toBe(false);
      expect(recorderHook.statusText).toBe("");
    } finally {
      if (previous) Object.defineProperty(globalThis, "navigator", previous);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });

  test.each(["stop", "setup failure", "hidden", "pagehide", "blur"])("web callbacks cannot affect a newer session (%s)", async reason => {
    const setupFailure = reason === "setup failure";
    Platform.OS = "web";
    const oldStop = jest.fn();
    const newStop = jest.fn();
    const close = jest.fn().mockResolvedValue(undefined);
    const recordings: any[] = [];
    const listeners = new Map<string, () => void>();
    const globals: Record<string, unknown> = {
      document: { hidden: false, addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) },
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
      navigator: { mediaDevices: { getUserMedia: jest.fn()
        .mockResolvedValueOnce({ getTracks: () => [{ stop: oldStop }] })
        .mockResolvedValueOnce({ getTracks: () => [{ stop: newStop }] }) } },
      MediaRecorder: class {
        state = "inactive";
        onstop: (() => void) | null = null;
        ondataavailable: ((event: unknown) => void) | null = null;
        constructor() { recordings.push(this); }
        start() { this.state = "recording"; }
        stop() { this.state = "inactive"; }
      },
      AudioContext: jest.fn().mockImplementation(() => ({
        createAnalyser: () => {
          if (setupFailure && recordings.length === 1) throw new Error("Audio setup failed");
          return { fftSize: 1024, getByteTimeDomainData: jest.fn() };
        },
        createMediaStreamSource: () => ({ connect: jest.fn() }),
        close,
      })),
      requestAnimationFrame: jest.fn(() => 1),
      cancelAnimationFrame: jest.fn(),
      alert: jest.fn(),
    };
    const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
    try {
      await act(async () => { tree = renderer.create(<TestComponent />); });
      await act(async () => { await recorderHook.startRecording(); });
      const staleOnStop = recordings[0].onstop;
      const staleOnData = recordings[0].ondataavailable;
      if (!setupFailure) act(() => {
        if (reason === "blur") tree!.update(<TestComponent focused={false} />);
        else if (reason === "hidden") {
          Object.defineProperty(document, "hidden", { configurable: true, value: true });
          listeners.get("visibilitychange")!();
          Object.defineProperty(document, "hidden", { configurable: true, value: false });
        } else if (reason === "pagehide") {
          listeners.get("pagehide")!();
          listeners.get("pageshow")!();
        } else recorderHook.stopRecording();
      });
      if (reason === "blur") act(() => { tree!.update(<TestComponent focused />); });
      expect(oldStop).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      await act(async () => { await recorderHook.startRecording(); });
      await act(async () => {
        staleOnData?.({ data: { size: 1 } });
        await staleOnStop?.();
      });
      expect(newStop).not.toHaveBeenCalled();
      expect(aiApi.transcribe).not.toHaveBeenCalled();
      expect(recorderHook.isRecording).toBe(true);
      act(() => { tree!.unmount(); tree = null; });
      expect(newStop).toHaveBeenCalledTimes(1);
    } finally {
      for (const key of Object.keys(globals)) {
        if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  test.each(["background", "blur", "discard"])("discards capture without ASR on %s, and never resumes automatically", async reason => {
    const recording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: jest.fn() };
    jest.mocked(Audio.requestPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Audio.setAudioModeAsync).mockResolvedValue(undefined);
    mockPrepareRecording.mockResolvedValue({ recording });
    await act(async () => { tree = renderer.create(<TestComponent focused />); });
    await act(async () => { await recorderHook.startRecording(); });
    await act(async () => {
      if (reason === "background") jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1]("background");
      else if (reason === "blur") tree!.update(<TestComponent focused={false} />);
      else recorderHook.discardRecording();
    });
    await act(async () => { recorderHook.discardRecording(); recorderHook.discardRecording(); });
    expect(recording.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
    expect(aiApi.transcribe).not.toHaveBeenCalled();
    expect(recorderHook.isRecording).toBe(false);
    await act(async () => {
      if (reason === "background") jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1]("active");
      if (reason === "blur") tree!.update(<TestComponent focused />);
    });
    expect(mockPrepareRecording).toHaveBeenCalledTimes(1);
    expect(onSpeechFinal).not.toHaveBeenCalled();
  });

  test.each(["permissions", "start", "transcription"])("route blur invalidates late native %s while mounted", async stage => {
    const pending = deferred<any>();
    const recording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: () => "old.m4a" };
    jest.mocked(Audio.requestPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Audio.setAudioModeAsync).mockResolvedValue(undefined);
    mockPrepareRecording.mockResolvedValue({ recording });
    jest.mocked(FileSystem.readAsStringAsync).mockResolvedValue("audio");
    const operation = stage === "permissions" ? Audio.requestPermissionsAsync : stage === "start" ? mockStartRecording : aiApi.transcribe;
    jest.mocked(operation).mockReturnValueOnce(pending.promise);
    await act(async () => { tree = renderer.create(<TestComponent focused />); });
    let start!: Promise<void>;
    await act(async () => { start = recorderHook.startRecording(); });
    if (stage === "transcription") await act(async () => { await start; recorderHook.stopRecording(); });
    await act(async () => { tree!.update(<TestComponent focused={false} />); });
    await act(async () => { await recorderHook.startRecording(); });
    await act(async () => { tree!.update(<TestComponent focused />); });
    await act(async () => { pending.resolve(stage === "permissions" ? { granted: true } : { text: "stale", run: { id: "old", status: "completed" } }); await start; });
    expect(onSpeechResult).not.toHaveBeenCalled();
    expect(onSpeechFinal).not.toHaveBeenCalled();
    expect(onSpeechEmpty).not.toHaveBeenCalled();
    expect(recorderHook.isRecording).toBe(false);
    expect(recorderHook.isTranscribing).toBe(false);
    if (stage !== "permissions") expect(recording.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
    else expect(mockPrepareRecording).not.toHaveBeenCalled();
  });

  test("StrictMode replay and refocus require fresh controls and a manual restart", async () => {
    const recording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: jest.fn() };
    jest.mocked(Audio.requestPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Audio.setAudioModeAsync).mockResolvedValue(undefined);
    mockPrepareRecording.mockResolvedValue({ recording });
    await act(async () => { tree = renderer.create(<React.StrictMode><TestComponent focused /></React.StrictMode>); });
    await act(async () => { await recorderHook.startRecording(); });
    const stale = recorderHook;
    await act(async () => { tree!.update(<React.StrictMode><TestComponent focused={false} /></React.StrictMode>); });
    await act(async () => { tree!.update(<React.StrictMode><TestComponent focused /></React.StrictMode>); });
    await act(async () => { await stale.startRecording(); stale.stopRecording(); });
    expect(mockPrepareRecording).toHaveBeenCalledTimes(1);
    expect(recording.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
    await act(async () => { await recorderHook.startRecording(); });
    expect(mockPrepareRecording).toHaveBeenCalledTimes(2);
    expect(recorderHook.isRecording).toBe(true);
  });

});
