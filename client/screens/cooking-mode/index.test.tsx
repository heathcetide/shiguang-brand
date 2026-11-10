let mockFocused = true;
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
import React from "react";
import renderer, { act } from "react-test-renderer";
import { Modal, Platform, Text, TouchableOpacity } from "react-native";
import type { Recipe } from "@/services/api";

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn() };
let mockParams: { recipeId?: string; queueItemId?: string; queueVersion?: number } = { recipeId: "10" };
let mockUser: { id: number; username: string } | null = { id: 1, username: "测试大厨" };

let mockSessionGeneration = 1;

const mockRecipeDetail = jest.fn();
const mockQueueList = jest.fn();
const mockVoiceCommand = jest.fn();
const mockWaitForAgentRun = jest.fn();
const mockVoiceRecorder = jest.fn();

jest.mock("@/services/api", () => ({
  recipesApi: { detail: (id: number) => mockRecipeDetail(id) },
  cookingQueueApi: { list: () => mockQueueList() },
  aiApi: { voiceCommand: (...args: unknown[]) => mockVoiceCommand(...args) },
  inventoryApi: { list: async () => [] },
  waitForAgentRun: (...args: unknown[]) => mockWaitForAgentRun(...args),
  ApiError: class extends Error {},
}));

jest.mock("@/services/api/client", () => ({
  requestJson: async () => ({ requirements: [] }),
}));

const mockAuthFetch = jest.fn();

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, sessionGeneration: mockSessionGeneration, isAuthenticated: Boolean(mockUser) }),
  useAuthFetch: () => mockAuthFetch,
}));

jest.mock("@/hooks/useSafeRouter", () => ({
  useSafeRouter: () => mockRouter,
  useSafeSearchParams: () => mockParams,
}));

jest.mock("@/components/Screen", () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/ThemedFontAwesome6", () => "FontAwesome6");

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 20, left: 0, right: 0 }),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => "uuid-1234",
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("@/hooks/useVoiceRecorder", () => ({
  useVoiceRecorder: (options: unknown) => {
    mockVoiceRecorder(options);
    return { isRecording: false, startRecording: jest.fn(), stopRecording: jest.fn() };
  },
}));

const mockRealtimeVoice = jest.fn();
jest.mock("@/hooks/useRealtimeCookingVoice", () => ({
  useRealtimeCookingVoice: (...args: unknown[]) => mockRealtimeVoice(...args),
}));

const mockSetTimerSeconds = jest.fn();
const mockSetTimerMode = jest.fn();
const mockSetIsTimerRunning = jest.fn();
const mockFinishTimer = jest.fn();

jest.mock("@/hooks/useCookingTimer", () => ({
  useCookingTimer: () => ({
    ready: true,
    notice: "切换步骤保留当前计时",
    timerSeconds: 180,
    timerMode: "countdown",
    isTimerRunning: false,
    setTimerSeconds: mockSetTimerSeconds,
    setTimerMode: mockSetTimerMode,
    setIsTimerRunning: mockSetIsTimerRunning,
    finish: mockFinishTimer,
  }),
}));

jest.mock("@/services/voicePackManager", () => ({
  prewarmVoicePack: jest.fn().mockResolvedValue(undefined),
  prefetchVoiceText: jest.fn().mockResolvedValue(undefined),
  speakWithVoiceFallback: jest.fn().mockResolvedValue("system"),
  stopVoiceOutput: jest.fn().mockResolvedValue(undefined),
  enqueueVoiceOutput: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-notifications", () => ({
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("notif-1"),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

import CookingModeScreen from "./index";
import { speakWithVoiceFallback, stopVoiceOutput } from "@/services/voicePackManager";

const sampleRecipe: Recipe = {
  id: 10,
  title: "经典番茄炒蛋",
  description: "快手家常菜",
  category: "家常菜",
  cooking_time: 15,
  servings: 2,
  ingredients: [
    { name: "鸡蛋", amount: "2个" },
    { name: "番茄", amount: "1个" },
  ],
  steps: [
    "鸡蛋打散备用，番茄切小块。",
    "热锅倒油，先将鸡蛋炒至凝固盛出。",
    "下入番茄翻炒出沙，再倒回鸡蛋翻炒均匀，出锅前加少许盐调味。",
  ],
};

describe("CookingModeScreen", () => {
  let tree: renderer.ReactTestRenderer | null = null;
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    mockFocused = true;
    jest.clearAllMocks();
    mockParams = { recipeId: "10" };
    mockUser = { id: 1, username: "测试大厨" };
    mockSessionGeneration = 1;
    mockRecipeDetail.mockResolvedValue(sampleRecipe);
    mockQueueList.mockResolvedValue([]);
    mockRealtimeVoice.mockReturnValue({ active: false, supported: false });
  });

  afterEach(() => {
    Platform.OS = originalPlatform;
    if (tree) {
      act(() => {
        tree!.unmount();
      });
      tree = null;
    }
  });

  const extractText = (node: renderer.ReactTestInstance) =>
    node.findAllByType(Text).map((t) => React.Children.toArray(t.props.children).join("")).join(" ");

  test("renders recipe steps and allows opening the kitchen timer modal", async () => {
    await act(async () => {
      tree = renderer.create(<CookingModeScreen />);
    });

    // Verify recipe title rendered
    const allText = extractText(tree!.root);
    expect(allText).toContain("经典番茄炒蛋");
    expect(allText).toContain("1/3 步");

    // Find the timer button and click it to open timer modal
    const buttons = tree!.root.findAllByType(TouchableOpacity);
    const timerButton = buttons.find((btn) => {
      const text = extractText(btn);
      return text.includes("建议") || text.includes("倒计时") || text.includes("正计时");
    });
    expect(timerButton).toBeDefined();

    await act(async () => {
      timerButton!.props.onPress();
    });

    // Check modal visibility
    const modals = tree!.root.findAllByType(Modal);
    expect(modals.length).toBeGreaterThan(0);
    const timerModal = modals.find((m) => m.props.visible === true);
    expect(timerModal).toBeDefined();

    // Verify modal contents
    const modalText = extractText(timerModal!);
    expect(modalText).toContain("厨房智能计时器");
    expect(modalText).toContain("+1 分钟");
    expect(modalText).toContain("+5 分钟");
    expect(modalText).toContain("重置");
    expect(modalText).toContain("切换步骤保留当前计时");
  });

  test("handles timer toggle mode, modifiers and start/pause", async () => {
    await act(async () => {
      tree = renderer.create(<CookingModeScreen />);
    });

    // Open timer modal
    const buttons = tree!.root.findAllByType(TouchableOpacity);
    const timerButton = buttons.find((btn) => {
      const text = extractText(btn);
      return text.includes("建议") || text.includes("倒计时") || text.includes("正计时");
    });
    expect(timerButton).toBeDefined();
    await act(async () => {
      timerButton!.props.onPress();
    });

    const timerModal = tree!.root.findAllByType(Modal).find((m) => m.props.visible === true)!;

    // Toggle timer mode
    const modeToggle = timerModal.findAllByType(TouchableOpacity).find((btn) =>
      extractText(btn).includes("模式")
    );
    expect(modeToggle).toBeDefined();
    await act(async () => {
      modeToggle!.props.onPress();
    });
    expect(mockSetTimerMode).toHaveBeenCalledWith("stopwatch");

    // Add 1 minute
    const addOneBtn = timerModal.findAllByType(TouchableOpacity).find((btn) =>
      extractText(btn).includes("+1 分钟")
    );
    expect(addOneBtn).toBeDefined();
    await act(async () => {
      addOneBtn!.props.onPress();
    });
    expect(mockSetTimerSeconds).toHaveBeenCalled();

    // Click start/pause
    const actionBtn = timerModal.findAllByType(TouchableOpacity).find((btn) => {
      const text = extractText(btn);
      return text.includes("开始") || text.includes("暂停");
    });
    expect(actionBtn).toBeDefined();
    await act(async () => {
      actionBtn!.props.onPress();
    });
    expect(mockSetIsTimerRunning).toHaveBeenCalled();
  });

  test.each(["ios", "android", "web"] as const)("shows truthful continuous voice guidance on %s", async (platform) => {
    Platform.OS = platform;
    mockRealtimeVoice.mockReturnValue({ active: true, supported: true, muted: false, state: "listening", stop: jest.fn() });
    await act(async () => {
      tree = renderer.create(<CookingModeScreen />);
    });
    act(() => {
      mockRealtimeVoice.mock.calls.at(-1)![0].onTranscript("继续计时", true);
    });
    const text = extractText(tree!.root);
    if (platform === "web") {
      expect(text).toContain("连续语音已开启，可直接说话或插话");
      expect(text).not.toContain("请等回复结束后再说话");
    } else {
      expect(text).toContain("连续语音已开启，请等回复结束后再说话");
      expect(text).not.toContain("可直接说话或插话");
    }
  });

  test.each([
    [true, "listening", "持续监听已静音，点麦克风恢复"],
    [false, "reconnecting", "连接较弱，正在恢复连续语音..."],
  ])("prioritizes mute and reconnect status over voice capability guidance", async (muted, state, expected) => {
    mockRealtimeVoice.mockReturnValue({ active: true, supported: true, muted, state, stop: jest.fn() });
    await act(async () => {
      tree = renderer.create(<CookingModeScreen />);
    });
    act(() => {
      mockRealtimeVoice.mock.calls.at(-1)![0].onTranscript("下一步", true);
    });
    expect(extractText(tree!.root)).toContain(expected);
    expect(extractText(tree!.root)).not.toContain("连续语音已开启");
  });

  const deferred = () => {
    let resolve!: (value: any) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<any>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  test.each(["account", "session", "recipe", "queue", "version", "unmount", "blur", "background"].flatMap((change) => ["TOGGLE_TIMER", "NEXT_STEP"].map((action) => [change, action])))("discards pending direct control after %s changes (%s)", async (change, action) => {
    const pending = deferred();
    mockVoiceCommand.mockReturnValue(pending.promise);
    await act(async () => { tree = renderer.create(<CookingModeScreen />); });
    const originalScope = mockVoiceRecorder.mock.calls.at(-1)![0].scopeKey;
    act(() => { mockVoiceRecorder.mock.calls.at(-1)![0].onSpeechFinal("开始计时"); });
    await act(async () => {
      if (change === "blur") mockFocused = false;
      if (change === "background") mockVoiceRecorder.mock.calls.at(-1)![0].onDiscard();
      if (change === "session") mockSessionGeneration += 1;
      if (change === "account") mockUser = { id: 2, username: "另一位" };
      if (change === "recipe") mockParams = { recipeId: "11" };
      if (change === "queue") mockParams = { recipeId: "10", queueItemId: "queue-new" };
      if (change === "version") mockParams = { recipeId: "10", queueVersion: 2 };
      if (change === "unmount") { tree!.unmount(); tree = null; }
      else tree!.update(<CookingModeScreen />);
    });
    if (tree && !["blur", "background"].includes(change)) expect(mockVoiceRecorder.mock.calls.at(-1)![0].scopeKey).not.toBe(originalScope);
    expect(stopVoiceOutput).toHaveBeenCalled();
    jest.mocked(speakWithVoiceFallback).mockClear();
    await act(async () => { pending.resolve({ type: "CONTROL", action }); });
    expect(mockSetIsTimerRunning).not.toHaveBeenCalled();
    expect(speakWithVoiceFallback).not.toHaveBeenCalled();
    if (tree) {
      expect(extractText(tree.root)).not.toMatch(/已为您开启倒计时|已为您切换至下一步/);
      expect(extractText(tree.root)).not.toContain("2/3 步");
    }
  });

  test.each(["scope", "session", "unmount", "newer request"])("discards pending agent answer after %s", async (change) => {
    const pending = deferred();
    mockVoiceCommand.mockResolvedValue({ type: "ANSWER", run: { id: "old-run", status: "pending" } });
    mockWaitForAgentRun.mockReturnValue(pending.promise);
    await act(async () => { tree = renderer.create(<CookingModeScreen />); });
    await act(async () => { mockVoiceRecorder.mock.calls.at(-1)![0].onSpeechFinal("怎么切菜"); });
    expect(mockWaitForAgentRun).toHaveBeenCalled();
    await act(async () => {
      if (change === "unmount") { tree!.unmount(); tree = null; }
      else if (change === "session") { mockSessionGeneration += 1; tree!.update(<CookingModeScreen />); }
      else if (change === "scope") { mockParams = { recipeId: "11" }; tree!.update(<CookingModeScreen />); }
      else {
        mockVoiceCommand.mockResolvedValue({ type: "ANSWER", answerText: "新的回答" });
        mockVoiceRecorder.mock.calls.at(-1)![0].onSpeechFinal("新问题");
      }
    });
    jest.mocked(speakWithVoiceFallback).mockClear();
    await act(async () => { pending.resolve({ id: "old-run", status: "completed", reply: "过期回答" }); });
    expect(speakWithVoiceFallback).not.toHaveBeenCalled();
    if (tree) expect(extractText(tree.root)).not.toContain("过期回答");
    if (change === "newer request") expect(extractText(tree!.root)).toContain("新的回答");
  });

  test("drops stale errors and old recorder callbacks after a scope change", async () => {
    const pending = deferred();
    mockVoiceCommand.mockReturnValue(pending.promise);
    await act(async () => { tree = renderer.create(<CookingModeScreen />); });
    const oldRecorder = mockVoiceRecorder.mock.calls.at(-1)![0];
    act(() => { oldRecorder.onSpeechFinal("旧问题"); });
    await act(async () => { mockUser = null; tree!.update(<CookingModeScreen />); });
    await act(async () => {
      oldRecorder.onSpeechResult("旧识别");
      oldRecorder.onSpeechFinal("旧识别");
      oldRecorder.onSpeechEmpty();
      pending.reject(new Error("旧错误"));
    });
    expect(mockVoiceCommand).toHaveBeenCalledTimes(1);
    expect(extractText(tree!.root)).not.toMatch(/旧识别|旧错误|未能清晰识别/);
  });

  test("current direct controls still update the timer and speak", async () => {
    mockVoiceCommand.mockResolvedValue({ type: "CONTROL", action: "TOGGLE_TIMER" });
    await act(async () => { tree = renderer.create(<CookingModeScreen />); });
    await act(async () => { mockVoiceRecorder.mock.calls.at(-1)![0].onSpeechFinal("开始计时"); });
    expect(mockSetIsTimerRunning).toHaveBeenCalledTimes(1);
    expect(extractText(tree!.root)).toContain("已为您开启倒计时");
    expect(speakWithVoiceFallback).toHaveBeenCalledWith(mockAuthFetch, "已为您开启倒计时", expect.anything());
  });

  test("displays error when recipeId is invalid", async () => {
    mockParams = { recipeId: "invalid" };
    await act(async () => {
      tree = renderer.create(<CookingModeScreen />);
    });

    const texts = tree!.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts.some((c) => typeof c === "string" && c.includes("菜谱编号无效"))).toBe(true);
  });
});
