import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import type { OnboardingState } from "@dietdigidose/contracts";

const mockGet = jest.fn(); const mockUpdate = jest.fn(); const mockRemove = jest.fn(); const mockWrite = jest.fn(); const mockRead = jest.fn();
const mockRouter = { push: jest.fn() };
let mockUser: { id: number } | null = { id: 1 };
let mockToken: string | null = "token-1";
let mockSession = 1;
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser, token: mockToken, sessionGeneration: mockSession }) }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => mockRouter }));
jest.mock("@/services/api/onboarding", () => ({ onboardingApi: { get: (...args: unknown[]) => mockGet(...args), update: (...args: unknown[]) => mockUpdate(...args) } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: (...args: unknown[]) => mockRead(...args) }));
jest.mock("@/utils/userStorage", () => ({
  getPrivateStorageGeneration: () => 0,
  getUserStorageKey: (key: string, userId: number) => `${key}:user:${userId}`,
  removeUserPrivateStorage: (...args: unknown[]) => mockRemove(...args),
  writeUserPrivateStorage: (...args: unknown[]) => mockWrite(...args),
}));
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]) }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));

import { OnboardingProgressCard } from "./OnboardingProgressCard";

function state(input: Partial<OnboardingState> = {}): OnboardingState {
  return { version: 1, selectedTask: "inventory", status: "in_progress", step: "task", dismissed: false, startedAt: "2026-09-20T00:00:00Z", completedAt: null, completion: null, updatedAt: null, ...input };
}
function press(tree: renderer.ReactTestRenderer, label: string) {
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label || node.findAllByType(Text).some(text => text.props.children === label));
  if (!button) throw new Error(`Missing button ${label}`);
  button.props.onPress();
}
async function render() { let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(<OnboardingProgressCard />); }); return tree; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }

beforeEach(() => {
  jest.clearAllMocks(); mockUser = { id: 1 }; mockToken = "token-1"; mockSession = 1;
  mockGet.mockReset().mockResolvedValue(state()); mockUpdate.mockReset().mockResolvedValue(state({ version: 2 }));
  mockRemove.mockResolvedValue(true); mockWrite.mockResolvedValue(true); mockRead.mockResolvedValue(null);
});

test("untouched and dismissed accounts receive no prompt", async () => {
  mockGet.mockResolvedValue(state({ version: 0, selectedTask: null, status: "not_started" }));
  const tree = await render(); expect(tree.toJSON()).toBeNull(); expect(mockUpdate).not.toHaveBeenCalled(); act(() => tree.unmount());
  mockGet.mockResolvedValue(state({ dismissed: true }));
  const dismissed = await render(); expect(dismissed.toJSON()).toBeNull(); act(() => dismissed.unmount());
});

test("a late response for a previous account cannot show progress or clear drafts", async () => {
  const pending = deferred<OnboardingState>(); mockGet.mockImplementation((token: string) => token === "token-1" ? pending.promise : Promise.resolve(state({ version: 0, selectedTask: null, status: "not_started" })));
  const tree = await render();
  mockUser = { id: 2 }; mockToken = "token-2"; mockSession = 2;
  await act(async () => { tree.update(<OnboardingProgressCard />); });
  await act(async () => { pending.resolve(state({ status: "completed", completedAt: "done", completion: { task: "inventory", resourceId: "1" } })); });
  expect(tree.toJSON()).toBeNull(); expect(mockRemove).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled(); act(() => tree.unmount());
});

test("closing waits for a successful save and failed saves retain the card", async () => {
  mockUpdate.mockRejectedValueOnce(new Error("网络暂不可用"));
  const tree = await render();
  await act(async () => { press(tree, "关闭首次任务提示"); });
  expect(JSON.stringify(tree.toJSON())).toContain("网络暂不可用");
  await act(async () => { press(tree, "关闭首次任务提示"); });
  expect(tree.toJSON()).toBeNull(); expect(mockUpdate).toHaveBeenLastCalledWith("token-1", expect.objectContaining({ version: 1, dismissed: true })); act(() => tree.unmount());
});

test("a paused task resumes before opening the onboarding page", async () => {
  mockGet.mockResolvedValue(state({ status: "paused" })); const tree = await render();
  await act(async () => { press(tree, "继续首次任务"); });
  expect(mockUpdate).toHaveBeenCalledWith("token-1", expect.objectContaining({ status: "in_progress", dismissed: false }));
  expect(mockRouter.push).toHaveBeenCalledWith("/onboarding"); act(() => tree.unmount());
});

test("confirmed completion clears only this user's draft and is acknowledged once", async () => {
  const completedAt = "2026-09-20T01:00:00Z";
  mockGet.mockResolvedValue(state({ version: 2, status: "completed", completedAt, completion: { task: "inventory", resourceId: "10" } }));
  const tree = await render();
  expect(JSON.stringify(tree.toJSON())).toContain("第一件事，完成了");
  expect(mockRemove).toHaveBeenCalledWith("@onboarding_draft_v2", 1, 0);
  expect(mockWrite).toHaveBeenCalledWith("@onboarding_completion_seen_v1", 1, 0, completedAt);
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  await act(async () => { press(tree, "关闭完成提示"); }); expect(tree.toJSON()).toBeNull();
  act(() => tree.unmount()); mockRead.mockResolvedValue(completedAt);
  const again = await render(); expect(again.toJSON()).toBeNull(); expect(mockUpdate).toHaveBeenCalledTimes(1); act(() => again.unmount());
});
