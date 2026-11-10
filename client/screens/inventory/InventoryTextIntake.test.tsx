import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";

const mockGet = jest.fn(); const mockWrite = jest.fn(); const mockRemove = jest.fn(); const mockSave = jest.fn(); const mockDone = jest.fn(); const mockToggle = jest.fn();
const mockStorage = new Map<string, string>();
let mockUser: { id: number } | null = { id: 1 };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/useVoiceRecorder", () => ({ useVoiceRecorder: () => ({ isRecording: false, isTranscribing: false, statusText: "", toggleRecording: mockToggle }) }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: (...args: unknown[]) => mockGet(...args) }));
jest.mock("@/utils/userStorage", () => ({
  AI_DATA_CONSENT_STORAGE_KEY: "consent", getPrivateStorageGeneration: () => 0,
  getUserStorageKey: (key: string, id: number) => `${key}:user:${id}`,
  writeUserPrivateStorage: (...args: unknown[]) => mockWrite(...args), removeUserPrivateStorage: (...args: unknown[]) => mockRemove(...args),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));

import { InventoryTextIntake } from "./InventoryTextIntake";
function press(tree: renderer.ReactTestRenderer, label: string) {
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label || node.findAllByType(Text).some(text => text.props.children === label));
  if (!button) throw new Error(`Missing button ${label}`);
  button.props.onPress();
}
function type(tree: renderer.ReactTestRenderer, label: string, value: string) { tree.root.findAllByType(TextInput).find(input => input.props.accessibilityLabel === label)!.props.onChangeText(value); }
async function render() { let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(<InventoryTextIntake saveIntake={mockSave} onSaved={mockDone} />); }); return tree; }
beforeEach(() => {
  jest.clearAllMocks(); mockUser = { id: 1 }; mockStorage.clear();
  mockGet.mockReset().mockImplementation((key: string) => Promise.resolve(mockStorage.get(key) ?? null));
  mockWrite.mockReset().mockImplementation((key: string, id: number, _generation: number, value: string) => { mockStorage.set(`${key}:user:${id}`, value); return Promise.resolve(true); });
  mockRemove.mockReset().mockImplementation((key: string, id: number) => { mockStorage.delete(`${key}:user:${id}`); return Promise.resolve(true); });
  mockSave.mockReset().mockResolvedValue({});
});

test("text stays local until an editable summary is requested and only confirmation saves inventory", async () => {
  const tree = await render();
  await act(async () => { type(tree, "口述或输入食材", "家里有鸡蛋三枚、番茄"); });
  expect(mockWrite).not.toHaveBeenCalled(); expect(mockSave).not.toHaveBeenCalled();
  await act(async () => { press(tree, "整理为待核对清单"); });
  expect(mockSave).not.toHaveBeenCalled();
  expect(tree.root.findAllByType(TextInput).find(input => input.props.accessibilityLabel === "第2项数量")!.props.value).toBe("");
  await act(async () => { type(tree, "第1项数量", "2枚"); });
  await act(async () => { press(tree, "确认并保存 2 项食材"); });
  expect(mockSave.mock.calls[0][0].items).toEqual(expect.arrayContaining([expect.objectContaining({ food_name: "鸡蛋", quantity_value: 2 }), expect.objectContaining({ food_name: "番茄", quantity_value: null })]));
  expect(mockDone).toHaveBeenCalledTimes(1); act(() => tree.unmount());
});

test("voice waits for account-scoped consent while text remains available", async () => {
  const tree = await render();
  await act(async () => { press(tree, "开始口述"); });
  expect(mockToggle).not.toHaveBeenCalled(); expect(mockGet).toHaveBeenCalledWith("consent:user:1");
  await act(async () => { press(tree, "同意并开始录音"); });
  expect(mockWrite).toHaveBeenCalledWith("consent", 1, 0, "accepted"); expect(mockToggle).toHaveBeenCalledTimes(1); act(() => tree.unmount());
});

test("a failed batch remains editable only after definitive rejection and keeps its retry identity otherwise", async () => {
  mockSave.mockRejectedValueOnce(new Error("响应超时"));
  const tree = await render();
  await act(async () => { type(tree, "口述或输入食材", "鸡蛋、番茄"); });
  await act(async () => { press(tree, "整理为待核对清单"); });
  await act(async () => { press(tree, "确认并保存 2 项食材"); });
  const original = mockSave.mock.calls[0][0];
  expect(tree.root.findAllByType(TextInput).find(input => input.props.accessibilityLabel === "第1项数量")!.props.editable).toBe(false);
  await act(async () => { press(tree, "重试确认保存结果"); });
  expect(mockSave.mock.calls[1][0]).toEqual(original); act(() => tree.unmount());
});
