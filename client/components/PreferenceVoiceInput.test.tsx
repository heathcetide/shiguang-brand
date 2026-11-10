let mockFocused = true;
let mockUserId = 1;
const mockToggleRecording = jest.fn();
let mockVoiceOptions: { scopeKey?: string; focused?: boolean };
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import { PreferenceVoiceInput } from "./PreferenceVoiceInput";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-file-system", () => ({ Paths: {} }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: mockUserId }, sessionGeneration: mockUserId }) }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/useVoiceRecorder", () => ({ useVoiceRecorder: (options: typeof mockVoiceOptions) => { mockVoiceOptions = options; return { isRecording: false, isTranscribing: false, statusText: "", toggleRecording: mockToggleRecording }; } }));

function press(tree: renderer.ReactTestRenderer, label: string) {
  tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!.props.onPress();
}

test.each([false, true])("complete summary is previewed and requires explicit confirmation; persistent=%s", (persistent) => {
  const apply = jest.fn(); let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<PreferenceVoiceInput onApply={apply} />); });
  act(() => { tree.root.findByType(TextInput).props.onChangeText("两个人，20分钟，不吃辣，预算30元，做饭新手，偶尔外食，平时吃午餐，在公司吃，需要带饭，不能冷藏，没有微波炉"); });
  expect(apply).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("不能冷藏");
  expect(JSON.stringify(tree.toJSON())).toContain("每餐预算 30 元");
  if (persistent) act(() => { press(tree, "保存为常用设置"); });
  expect(apply).not.toHaveBeenCalled();
  act(() => { press(tree, "确认摘要，应用到表单"); });
  expect(apply).toHaveBeenCalledWith({ servings: 2, meal_time_minutes: 20, avoid_spicy: true, budget_per_meal: 30, cooking_level: "beginner", eating_out_frequency: "sometimes", usual_meals: ["lunch"], eating_location: "work", carry_meals: true, refrigeration_available: false, reheating_available: false }, persistent);
  act(() => tree.unmount());
});

test("negative facilities stay unavailable in the reviewed and applied summary", () => {
  const apply = jest.fn(); let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<PreferenceVoiceInput onApply={apply} />); });
  act(() => { tree.root.findByType(TextInput).props.onChangeText("不可以吃辣，不会带饭，不可以冷藏，不可以加热"); });
  expect(tree.root.findAllByType(Text).some(node => node.props.children === "不吃辣 · 不带饭 · 不能冷藏 · 不能加热")).toBe(true);
  expect(apply).not.toHaveBeenCalled();
  act(() => { press(tree, "确认摘要，应用到表单"); });
  expect(apply).toHaveBeenCalledWith({ avoid_spicy: true, carry_meals: false, refrigeration_available: false, reheating_available: false }, false);
  act(() => tree.unmount());
});


test.each(["blur", "account"])("late consent read cannot start capture after %s", async reason => {
  mockFocused = true; mockUserId = 1; mockToggleRecording.mockClear();
  let resolve!: (value: string) => void;
  jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PreferenceVoiceInput onApply={jest.fn()} />); });
  const oldScope = mockVoiceOptions.scopeKey;
  await act(async () => { press(tree, "按一下开始口述"); });
  if (reason === "blur") mockFocused = false;
  else mockUserId = 2;
  await act(async () => { tree.update(<PreferenceVoiceInput onApply={jest.fn()} />); });
  await act(async () => { resolve("accepted"); });
  expect(mockToggleRecording).not.toHaveBeenCalled();
  if (reason === "account") expect(mockVoiceOptions.scopeKey).not.toBe(oldScope);
  else expect(mockVoiceOptions.focused).toBe(false);
  await act(async () => { tree.unmount(); });
  mockFocused = true; mockUserId = 1;
});

test("account change clears a prior account's preference transcript", () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<PreferenceVoiceInput onApply={jest.fn()} />); });
  act(() => { tree.root.findByType(TextInput).props.onChangeText("两个人，不吃辣"); });
  mockUserId = 2;
  act(() => { tree.update(<PreferenceVoiceInput onApply={jest.fn()} />); });
  expect(tree.root.findByType(TextInput).props.value).toBe("");
  act(() => tree.unmount());
  mockUserId = 1;
});
