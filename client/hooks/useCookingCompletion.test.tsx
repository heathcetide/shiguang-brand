import React, { useEffect } from "react";
import renderer, { act } from "react-test-renderer";
const mockStore = new Map<string, string>();
const mockComplete = jest.fn();
const mockFetch = jest.fn();
jest.mock("@/services/api", () => ({ dietApi: { completeCooking: (...args: unknown[]) => mockComplete(...args) }, ApiError: class extends Error {} }));
jest.mock("expo-file-system", () => ({ Paths: { cache: { size: 0 } } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStore.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockStore.delete(key); }),
} }));
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCookingCompletion } from "./useCookingCompletion";
import { invalidatePrivateStorage } from "@/utils/userStorage";
let hook!: ReturnType<typeof useCookingCompletion>;
function Harness({ userId = 601 }: { userId?: number }) { const value = useCookingCompletion(userId, mockFetch); useEffect(() => { hook = value; }); return null; }
const request = { idempotency_key: "cooking-restart-204", inventory_consumptions: [{ item_id: 1, version: 3, mode: "all" as const }],
  production: { food_name: "饭", produced_servings: 2, eaten_servings: 1, eaten_at: "2026-09-11", eaten_time: "12:30", meal_type: "午餐", nutrition_per_serving: {} } };
beforeEach(() => { jest.clearAllMocks(); mockStore.clear(); });

test("lost response survives remount with exact request, then a real second cooking gets a new identity", async () => {
  mockComplete.mockRejectedValueOnce(new Error("response lost")).mockResolvedValue({ repeated: true });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<Harness />); });
  await act(async () => { await expect(hook.submit(async () => request)).rejects.toThrow("response lost"); });
  act(() => tree.unmount());
  await act(async () => { tree = renderer.create(<Harness />); });
  expect(hook.pending).toEqual(request);
  const rebuild = jest.fn();
  await act(async () => { await hook.submit(rebuild); });
  expect(rebuild).not.toHaveBeenCalled();
  expect(mockComplete.mock.calls[0][1]).toEqual(mockComplete.mock.calls[1][1]);
  expect(hook.pending).toBeNull();
  const next = { ...request, idempotency_key: "cooking-second-204" };
  await act(async () => { await hook.submit(async () => next); });
  expect(mockComplete.mock.calls[2][1].idempotency_key).toBe(next.idempotency_key);
  act(() => tree.unmount());
});

test("persistence failure prevents sending and account switch never restores another account", async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<Harness />); });
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
  await act(async () => { await expect(hook.submit(async () => request)).rejects.toThrow("disk full"); });
  expect(mockComplete).not.toHaveBeenCalled();
  mockStore.set("cooking-completion-pending:user:601", JSON.stringify(request));
  await act(async () => { tree.update(<Harness userId={602} />); });
  expect(hook.pending).toBeNull();
  invalidatePrivateStorage(602);
  await expect(hook.submit(async () => request)).rejects.toThrow();
  expect(mockComplete).not.toHaveBeenCalled();
  act(() => tree.unmount());
});
