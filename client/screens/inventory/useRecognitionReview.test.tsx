import React from "react";
import renderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRecognitionReview } from "./useRecognitionReview";
import { activatePrivateStorage } from "@/utils/userStorage";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-file-system", () => ({ Paths: {} }));
let mockUser = { id: 701 };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
let review!: ReturnType<typeof useRecognitionReview>;
function Probe() { const value = useRecognitionReview(); React.useLayoutEffect(() => { review = value; }); return null; }
async function mount() { let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(<Probe />); }); return tree; }
const food = { id: "job:0", foodName: "米", quantity: "一袋", suggestedStorageLocation: "常温", estimatedExpireDays: null, expirationDate: "", selected: true,
  fieldEvidence: { quantity: { status: "unknown" as const, source: "user" as const } } };
const request = { idempotency_key: "review-retry-701", source: "image" as const, source_reference: "job", items: [{ food_name: "米", category: "主食", quantity: "一袋", quantity_value: null, quantity_unit: null,
  expiration_date: "", storage_location: "常温" as const, confirmed: true as const, source: "image" as const, source_item_id: "job:0", image_url: null }] };
beforeEach(async () => { await AsyncStorage.clear(); mockUser = { id: 701 }; activatePrivateStorage(701); activatePrivateStorage(702); });

test("edited quantities, evidence, exclusions and request identity survive remount", async () => {
  let tree = await mount();
  await act(async () => { await review.update({ foods: [food, { ...food, id: "job:1", selected: false }], batchKey: request.idempotency_key, jobId: "job" }); });
  expect(review.canPresent("job")).toBe(true); expect(review.canPresent("other-job")).toBe(false);
  await act(async () => { await review.submit(request, async () => { throw new Error("response lost"); }, () => true).catch(() => undefined); });
  act(() => tree.unmount()); tree = await mount();
  expect(review.value.foods).toEqual([food, { ...food, id: "job:1", selected: false }]);
  expect(review.value.pending).toMatchObject(request);
  expect(review.canPresent("job")).toBe(false);
  expect(() => review.setFoods([])).toThrow("重试原请求");
  const send = jest.fn(async (_input: typeof request) => ({ repeated: true }));
  await act(async () => { await review.submit({ ...request, idempotency_key: "different" }, send, () => true); });
  expect(send.mock.calls[0][0]).toMatchObject(request);
  expect(review.value.pending).toBeNull(); expect(review.value.foods).toEqual([]);
  expect(await AsyncStorage.getItem("@inventory_recognition_review_v1:user:701")).toBeNull();
  act(() => tree.unmount());
});
test("storage failure rejects the pre-send checkpoint and the same request can be retried", async () => {
  const tree = await mount();
  const originalSet = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  const setItem = jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));
  const send = jest.fn(async () => undefined);
  await act(async () => { await expect(review.submit(request, send, () => true)).rejects.toThrow("disk full"); });
  expect(send).not.toHaveBeenCalled();
  expect(review.error).toContain("尚未保存");
  await act(async () => { await review.update({ pending: review.current.current.pending }); });
  expect(review.error).toBe(""); setItem.mockImplementation(originalSet); act(() => tree.unmount());
});
test("switching accounts never exposes or retries the other account's pending review", async () => {
  const tree = await mount();
  await act(async () => { await review.update({ foods: [food], pending: request }); });
  mockUser = { id: 702 }; await act(async () => { tree.update(<Probe />); });
  expect(review.value.foods).toEqual([]); expect(review.value.pending).toBeNull();
  expect(review.current.current.pending).toBeNull();
  expect(await AsyncStorage.getItem("@inventory_recognition_review_v1:user:701")).not.toBeNull();
  act(() => tree.unmount());
});

test("a definite validation rejection preserves editable fields without keeping an uncertain request", async () => {
  const tree = await mount();
  await act(async () => { await review.update({ foods: [food], batchKey: request.idempotency_key }); });
  const failure = Object.assign(new Error("invalid scan item"), { status: 400 });
  await act(async () => { await expect(review.submit(request, async () => { throw failure; }, () => true)).rejects.toThrow("invalid scan item"); });
  expect(review.value.pending).toBeNull(); expect(review.value.foods).toEqual([food]);
  await act(async () => { review.setFoods([{ ...food, quantity: "2袋" }]); });
  expect(review.value.foods[0].quantity).toBe("2袋"); act(() => tree.unmount());
});

test("a late successful response cannot clear the next account's review", async () => {
  const tree = await mount();
  let resolve!: () => void;
  let started!: () => void;
  const response = new Promise<void>(done => { resolve = done; });
  const sending = new Promise<void>(done => { started = done; });
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = review.submit(request, () => { started(); return response; }, () => mockUser.id === 701);
    await sending;
  });
  mockUser = { id: 702 }; await act(async () => { tree.update(<Probe />); });
  await act(async () => { await review.update({ foods: [{ ...food, foodName: "另一账号" }], batchKey: "other-account" }); });
  await act(async () => { resolve(); await pending; });
  expect(review.value.foods[0].foodName).toBe("另一账号");
  expect(await AsyncStorage.getItem("@inventory_recognition_review_v1:user:702")).not.toBeNull();
  act(() => tree.unmount());
});
