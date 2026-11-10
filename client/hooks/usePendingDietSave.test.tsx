import React from "react";
import renderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePendingDietSave } from "./usePendingDietSave";
import { activatePrivateStorage, purgeUserPrivateStorage } from "@/utils/userStorage";
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-file-system", () => ({ Paths: {} }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
const mockCreate = jest.fn(); const mockFetch = jest.fn(); let mockId = 1;
jest.mock("@/services/api/diet", () => ({ dietApi: { create: (...args: unknown[]) => mockCreate(...args) } }));
const payload = { meal_type: "午餐", food_name: "鸡蛋", amount: "1个", calories: null, protein: null, carbs: null, fat: null, recorded_at: "2026-09-20", recorded_time: "12:00", image_url: null };
let subject!: ReturnType<typeof usePendingDietSave>;
function Probe() { const value = usePendingDietSave(mockId, mockFetch); React.useLayoutEffect(() => { subject = value; }); return null; }
async function mount() { let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(<Probe />); }); return tree; }
beforeEach(async () => { await AsyncStorage.clear(); mockId = 1; activatePrivateStorage(1); activatePrivateStorage(2); mockCreate.mockReset().mockResolvedValue({ ...payload, id: 1 }); });

test("an uncertain response survives restart and retries the same confirmed payload and key", async () => {
  mockCreate.mockRejectedValueOnce(new Error("response lost"));
  let tree = await mount(); await act(async () => { await expect(subject.save(payload)).rejects.toThrow("response lost"); });
  const original = mockCreate.mock.calls[0][1];
  await act(async () => { tree.unmount(); }); tree = await mount();
  expect(subject.pending).toEqual(original);
  await act(async () => { await expect(subject.save({ ...payload, food_name: "不同内容" })).rejects.toThrow("上次记录"); });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  await act(async () => { await subject.save(); });
  expect(mockCreate.mock.calls[1][1]).toEqual(original); expect(subject.pending).toBeNull();
  expect(await AsyncStorage.getItem("@pending_manual_diet_v1:user:1")).toBeNull();
  await act(async () => { tree.unmount(); });
});

test("another account cannot inherit or retry the previous account's pending write", async () => {
  mockCreate.mockRejectedValueOnce(new Error("offline")); const tree = await mount();
  await act(async () => { await expect(subject.save(payload)).rejects.toThrow(); });
  mockId = 2; await act(async () => { tree.update(<Probe />); });
  expect(subject.pending).toBeNull(); await act(async () => { await expect(subject.save()).rejects.toThrow("没有"); });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  await purgeUserPrivateStorage(1); expect(await AsyncStorage.getItem("@pending_manual_diet_v1:user:1")).toBeNull();
  await act(async () => { tree.unmount(); });
});

test("a durable write is required before sending the server mutation", async () => {
  const tree = await mount();
  const original = (AsyncStorage.setItem as jest.Mock).getMockImplementation();
  const storage = jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk unavailable"));
  await act(async () => { await expect(subject.save(payload)).rejects.toThrow("disk unavailable"); });
  expect(mockCreate).not.toHaveBeenCalled();
  storage.mockImplementation(original!); await act(async () => { tree.unmount(); });
});
