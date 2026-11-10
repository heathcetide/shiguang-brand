jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
import React from "react";
import renderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AgentResponse, ChatSession, Message } from "./types";

jest.setTimeout(15_000);

const mockStorage = new Map<string, string>();
const mockChat = jest.fn();
const mockRun = jest.fn();
const mockDelete = jest.fn();
const mockWait = jest.fn();
const mockSpeak = jest.fn();
const mockStop = jest.fn();
const mockFetch = jest.fn();
let mockOwner = { userId: 1, generation: 1, active: true };
let mockCheck: (userId: number, generation: number) => boolean;
let mockVoice: { onSpeechFinal: (text: string) => void; onDiscard: () => void };
let mockUuid = 0;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: () => true };
const mockParams = {};

jest.mock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
} }));
jest.mock("@/services/api", () => ({
  aiApi: { chat: (...args: unknown[]) => mockChat(...args), agentRun: (...args: unknown[]) => mockRun(...args), deleteConversation: (...args: unknown[]) => mockDelete(...args) },
  healthApi: { profile: async () => null }, waitForAgentRun: (...args: unknown[]) => mockWait(...args), ApiError: class extends Error {},
}));
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockOwner.active ? { id: mockOwner.userId } : null, sessionGeneration: mockOwner.generation, isSessionCurrent: mockCheck }),
  useAuthFetch: () => mockFetch,
}));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => "Icon");
jest.mock("@/components/VoiceWaveform", () => ({ VoiceWaveform: "VoiceWaveform" }));
jest.mock("expo-blur", () => ({ BlurView: "BlurView" }));
jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-file-system", () => ({ Paths: { cache: { size: 0 } } }));
jest.mock("expo-crypto", () => ({ randomUUID: () => `id-${++mockUuid}` }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => mockRouter, useSafeSearchParams: () => mockParams }));
jest.mock("@/hooks/useVoiceRecorder", () => ({ useVoiceRecorder: (options: typeof mockVoice) => { mockVoice = options; return { isRecording: false, toggleRecording: jest.fn(), stopRecording: jest.fn() }; } }));
jest.mock("@/hooks/useTTS", () => ({ useTTS: () => ({ speak: mockSpeak, stop: mockStop, isSpeaking: false, error: "" }) }));
jest.mock("./AssistantMessageItem", () => ({ AssistantMessageItem: (props: unknown) => require("react").createElement("AssistantMessage", props) }));
jest.mock("./AssistantDrawers", () => ({ HistoryDrawer: (props: unknown) => require("react").createElement("History", props), ShoppingListDrawer: () => null }));

import AIAssistantScreen from "./index";
import { getChatSessionStore } from "./chatSessionStore";

const key = (id = 1) => `@shiyu_ai_chat_sessions:user:${id}`;
const message = (id: string): Message => ({ id, sender: "ai", text: `对话${id}`, time: "刚刚" });
const session = (id: string): ChatSession => ({ id, title: id, updatedAt: "12:00", messages: [message(id)] });
const response = (sessionId = "A"): AgentResponse & { events: [] } => ({
  mode: "agent", run: { id: `run-${sessionId}`, sessionId, modality: "text", source: "assistant", status: "queued", artifacts: [], createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z" }, events: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function history(tree: renderer.ReactTestRenderer) { return tree.root.findByType("History" as never); }
function visibleMessages(tree: renderer.ReactTestRenderer): Message[] { return tree.root.findAllByType("AssistantMessage" as never).map(item => item.props.message); }
function select(tree: renderer.ReactTestRenderer, id: string) {
  const drawer = history(tree);
  drawer.props.onSelect(drawer.props.sessions.find((item: ChatSession) => item.id === id));
}
async function send(tree: renderer.ReactTestRenderer, text = "创建A的任务") {
  await act(async () => { void tree.root.findAllByType("AssistantMessage" as never)[0].props.handleSendMessage(text); });
}
async function flush() {
  await act(async () => { await getChatSessionStore(mockOwner.userId, mockOwner.generation, mockCheck).flush(); });
}
let tree: renderer.ReactTestRenderer;
async function mount() { await act(async () => { tree = renderer.create(<AIAssistantScreen />); }); return tree; }

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockStorage.clear(); mockUuid = 0;
  mockOwner = { userId: 1, generation: 1, active: true };
  mockCheck = (id, generation) => mockOwner.active && mockOwner.userId === id && mockOwner.generation === generation;
  mockStorage.set(key(), JSON.stringify([session("A"), session("B")]));
  mockStorage.set("@ai_data_consent_v1:user:1", "accepted");
  mockDelete.mockReset().mockResolvedValue({});
  mockRun.mockReset().mockImplementation((_fetch, id) => Promise.resolve({ ...response(id.slice(4)), run: { ...response(id.slice(4)).run, status: "completed", reply: `完成${id}`, updatedAt: "2026-09-20T00:00:01Z" } }));
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (storageKey: string, value: string) => { mockStorage.set(storageKey, value); });
});
afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); });

test.each([false, true])("late creation returns to A without replacing B (return before response: %s)", async returnBeforeResponse => {
  const pending = deferred<AgentResponse>(); mockChat.mockReturnValue(pending.promise);
  await mount(); await send(tree);
  await act(async () => { select(tree, "B"); });
  if (returnBeforeResponse) await act(async () => { select(tree, "A"); });
  await act(async () => { pending.resolve(response()); });
  if (!returnBeforeResponse) {
    expect(visibleMessages(tree).map(item => item.text)).toEqual(["对话B"]);
    expect(mockRun).not.toHaveBeenCalled();
    await act(async () => { select(tree, "A"); });
  }
  expect(visibleMessages(tree).some(item => item.agentRun?.run.id === "run-A")).toBe(true);
  expect(mockRun).toHaveBeenCalledWith(mockFetch, "run-A", 0);
  expect(mockChat).toHaveBeenCalledTimes(1);
  await flush();
  const saved: ChatSession[] = JSON.parse(mockStorage.get(key())!);
  expect(saved.find(item => item.id === "A")!.messages.some(item => item.agentRun?.run.id === "run-A")).toBe(true);
  expect(saved.find(item => item.id === "B")!.messages).toEqual([message("B")]);
});

test.each([false, true])("late creation survives unmount (remount before response: %s)", async remountBeforeResponse => {
  const pending = deferred<AgentResponse>(); mockChat.mockReturnValue(pending.promise);
  await mount(); await send(tree);
  act(() => tree.unmount());
  if (remountBeforeResponse) await mount();
  await act(async () => { pending.resolve(response()); });
  await flush();
  expect(JSON.parse(mockStorage.get(key())!)[0].messages.some((item: Message) => item.agentRun?.run.id === "run-A")).toBe(true);
  if (!remountBeforeResponse) await mount();
  expect(visibleMessages(tree).some(item => item.agentRun?.run.id === "run-A")).toBe(true);
  expect(mockRun).toHaveBeenCalledWith(mockFetch, "run-A", 0);
  expect(mockChat).toHaveBeenCalledTimes(1);
});

test.each(["account", "generation", "logout"])("late creation is ignored after %s changes while unmounted", async change => {
  const pending = deferred<AgentResponse>(); mockChat.mockReturnValue(pending.promise);
  await mount(); await send(tree); await flush();
  act(() => tree.unmount());
  const before = mockStorage.get(key());
  if (change === "account") mockOwner.userId = 2;
  else if (change === "generation") mockOwner.generation += 1;
  else mockOwner.active = false;
  await act(async () => { pending.resolve(response()); });
  expect(mockStorage.get(key())).toBe(before);
  expect(mockRun).not.toHaveBeenCalled();
});

test("deleting A while its creation is pending never revives the conversation", async () => {
  const pending = deferred<AgentResponse>(); mockChat.mockReturnValue(pending.promise);
  await mount(); await send(tree);
  await act(async () => { select(tree, "B"); });
  await act(async () => { await history(tree).props.onDelete("A"); });
  await act(async () => { pending.resolve(response()); });
  await flush();
  expect(history(tree).props.sessions.map((item: ChatSession) => item.id)).toEqual(["B"]);
  expect(JSON.parse(mockStorage.get(key())!).map((item: ChatSession) => item.id)).toEqual(["B"]);
  expect(mockRun).not.toHaveBeenCalled();
});

test("concurrent A/B creation responses and a delayed storage write preserve both tasks", async () => {
  const first = deferred<AgentResponse>(); const second = deferred<AgentResponse>();
  mockChat.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await mount();
  const disk = deferred<void>();
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(async (storageKey: string, value: string) => { await disk.promise; mockStorage.set(storageKey, value); });
  await send(tree);
  await act(async () => { select(tree, "B"); });
  await send(tree, "创建B的任务");
  await act(async () => { second.resolve(response("B")); first.resolve(response("A")); });
  await act(async () => { disk.resolve(); });
  await flush();
  const saved: ChatSession[] = JSON.parse(mockStorage.get(key())!);
  for (const id of ["A", "B"]) expect(saved.find(item => item.id === id)!.messages.some(item => item.agentRun?.run.id === `run-${id}`)).toBe(true);
  expect(visibleMessages(tree).some(item => item.agentRun?.run.id === "run-A")).toBe(false);
  expect(mockChat).toHaveBeenCalledTimes(2);
});

test("a background voice creation is restored without starting foreground TTS", async () => {
  const pending = deferred<AgentResponse>(); mockChat.mockReturnValue(pending.promise);
  await mount();
  await act(async () => { mockVoice.onSpeechFinal("给我一个菜谱"); });
  await act(async () => { select(tree, "B"); });
  await act(async () => { pending.resolve(response()); });
  expect(mockWait).not.toHaveBeenCalled();
  expect(mockSpeak).not.toHaveBeenCalled();
  await act(async () => { select(tree, "A"); });
  expect(visibleMessages(tree).some(item => item.agentRun?.run.id === "run-A")).toBe(true);
  expect(mockSpeak).not.toHaveBeenCalled();
});

test.each([
  ["text", "background"], ["text", "returned"], ["text", "unmounted"],
  ["voice", "background"], ["voice", "returned"], ["voice", "unmounted"],
])("late %s creation failure is saved to its origin while %s", async (modality, navigation) => {
  const pending = deferred<AgentResponse>(); mockChat.mockReturnValue(pending.promise);
  await mount();
  if (modality === "voice") await act(async () => { mockVoice.onSpeechFinal("创建A的任务"); });
  else await send(tree);
  if (navigation === "unmounted") act(() => tree.unmount());
  else {
    await act(async () => { select(tree, "B"); });
    if (navigation === "returned") await act(async () => { select(tree, "A"); });
  }

  const errorText = navigation === "unmounted" ? "网络连接中断，无法确认创建结果" : "任务服务暂不可用";
  await act(async () => { pending.reject(new Error(errorText)); });
  await flush();
  const saved: ChatSession[] = JSON.parse(mockStorage.get(key())!);
  const failed = saved.find(item => item.id === "A")!.messages.at(-1);
  expect(failed).toMatchObject({ sender: "ai", text: errorText, status: "failed" });
  expect(failed?.agentRun).toBeUndefined();
  expect(saved.find(item => item.id === "B")!.messages).toEqual([message("B")]);
  if (navigation === "background") {
    expect(visibleMessages(tree).map(item => item.text)).toEqual(["对话B"]);
    await act(async () => { select(tree, "A"); });
  } else if (navigation === "unmounted") await mount();
  expect(visibleMessages(tree).at(-1)).toMatchObject({ text: errorText, status: "failed" });
  expect(mockChat).toHaveBeenCalledTimes(1);
  expect(mockRun).not.toHaveBeenCalled();
  expect(mockWait).not.toHaveBeenCalled();
  expect(mockSpeak).not.toHaveBeenCalled();
});

test.each(["conversation", "account", "generation", "logout"])("clears completed voice replay and stops output on %s change", async change => {
  mockChat.mockResolvedValue(response());
  mockWait.mockResolvedValue({ ...response().run, status: "completed", reply: "旧会话私有回答" });
  await mount();
  await act(async () => { mockVoice.onSpeechFinal("给我一个菜谱"); });
  expect(mockSpeak).toHaveBeenCalledWith("旧会话私有回答");
  expect(tree.root.findAll(node => node.props.children === "重播回答").length).toBeGreaterThan(0);
  mockStop.mockClear();
  if (change === "conversation") await act(async () => { select(tree, "B"); });
  else {
    if (change === "account") mockOwner.userId = 2;
    if (change === "generation") mockOwner.generation += 1;
    if (change === "logout") mockOwner.active = false;
    await act(async () => { tree.update(<AIAssistantScreen />); });
  }
  expect(mockStop).toHaveBeenCalled();
  expect(tree.root.findAll(node => node.props.children === "重播回答")).toHaveLength(0);
});

test("a voice result completed after a conversation switch cannot restore replay", async () => {
  const pending = deferred<AgentResponse["run"]>();
  mockChat.mockResolvedValue(response()); mockWait.mockReturnValue(pending.promise);
  await mount(); await act(async () => { mockVoice.onSpeechFinal("给我一个菜谱"); });
  await act(async () => { select(tree, "B"); });
  await act(async () => { pending.resolve({ ...response().run, status: "completed", reply: "迟到的旧回答" }); });
  expect(mockSpeak).not.toHaveBeenCalled();
  expect(tree.root.findAll(node => node.props.children === "重播回答")).toHaveLength(0);
});


test.each(["conversation", "account", "logout"])("ignores retained ASR callbacks after %s change", async change => {
  await mount();
  const oldVoice = mockVoice;
  if (change === "conversation") await act(async () => { select(tree, "B"); });
  else {
    if (change === "account") mockOwner.userId = 2;
    else mockOwner.active = false;
    await act(async () => { tree.update(<AIAssistantScreen />); });
  }
  await act(async () => { oldVoice.onSpeechFinal("来自旧账号录音的识别结果"); });
  expect(mockChat).not.toHaveBeenCalled();
  expect(mockWait).not.toHaveBeenCalled();
  expect(mockSpeak).not.toHaveBeenCalled();
  expect(tree.root.findAll(node => node.props.children === "重播回答")).toHaveLength(0);
});


test("foreground cancellation suppresses late voice TTS without losing the submitted task", async () => {
  const pending = deferred<AgentResponse>(); mockChat.mockReturnValue(pending.promise);
  await mount();
  await act(async () => { mockVoice.onSpeechFinal("给我一个菜谱"); });
  act(() => { mockVoice.onDiscard(); });
  await act(async () => { pending.resolve(response()); });
  expect(mockWait).not.toHaveBeenCalled();
  expect(mockSpeak).not.toHaveBeenCalled();
  expect(visibleMessages(tree).some(item => item.agentRun?.run.id === "run-A")).toBe(true);
});
