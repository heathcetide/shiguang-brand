import React from "react";
import renderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useUserDraft } from "./useUserDraft";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-file-system", () => ({ Paths: {} }));
let mockUser: { id: number } | null = { id: 1 };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
import { activatePrivateStorage, invalidatePrivateStorage, purgeUserPrivateStorage } from "@/utils/userStorage";

let draft!: ReturnType<typeof useUserDraft<string>>;
function Probe() { const value = useUserDraft("@test-draft", "", value => String(value)); React.useLayoutEffect(() => { draft = value; }); return null; }
async function mount() { let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(<Probe />); }); return tree; }
beforeEach(async () => { await AsyncStorage.clear(); mockUser = { id: 1 }; activatePrivateStorage(1); activatePrivateStorage(2); });

test("confirmed form inputs resume for the same account and clear after saving", async () => {
  let tree = await mount();
  await act(async () => { draft.save("两个人"); draft.save("三个人"); });
  await act(async () => { tree.unmount(); });
  tree = await mount();
  expect(draft.ready).toBe(true); expect(draft.value).toBe("三个人");
  await act(async () => { await draft.clear(); });
  expect(await AsyncStorage.getItem("@test-draft:user:1")).toBeNull();
  await act(async () => { tree.unmount(); });
});

test("late hydration from the previous account never replaces the active draft", async () => {
  let resolve!: (value: string | null) => void;
  const originalGet = (AsyncStorage.getItem as jest.Mock).getMockImplementation();
  const getItem = jest.spyOn(AsyncStorage, "getItem").mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const tree = await mount(); expect(draft.ready).toBe(false);
  mockUser = { id: 2 };
  await act(async () => { tree.update(<Probe />); });
  await act(async () => { draft.save("账号二"); resolve(JSON.stringify("账号一")); });
  expect(draft.value).toBe("账号二");
  expect(await AsyncStorage.getItem("@test-draft:user:2")).toBe(JSON.stringify("账号二"));
  getItem.mockImplementation(originalGet!); await act(async () => { tree.unmount(); });
});

test("logout invalidates queued writes and removes only that account's drafts", async () => {
  await AsyncStorage.setItem("@test-draft:user:2", JSON.stringify("other"));
  const tree = await mount();
  await act(async () => { draft.save("queued"); await purgeUserPrivateStorage(1); });
  expect(await AsyncStorage.getItem("@test-draft:user:1")).toBeNull();
  expect(await AsyncStorage.getItem("@test-draft:user:2")).toBe(JSON.stringify("other"));
  await act(async () => { tree.unmount(); });
});

test("a corrupt draft remains editable with a visible recovery message", async () => {
  await AsyncStorage.setItem("@test-draft:user:1", "{");
  const tree = await mount(); expect(draft.ready).toBe(true); expect(draft.value).toBe(""); expect(draft.error).toContain("无法读取");
  await act(async () => { draft.save("recovered"); });
  expect(draft.error).toBe(""); await act(async () => { tree.unmount(); });
});

test("a clear waiting for an old session's write cannot delete the next session's draft", async () => {
  const tree = await mount();
  const originalSet = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  let finishWrite!: () => void;
  let startWrite!: () => void;
  const pendingWrite = new Promise<void>(resolve => { finishWrite = resolve; });
  const writing = new Promise<void>(resolve => { startWrite = resolve; });
  const setItem = jest.spyOn(AsyncStorage, "setItem").mockImplementationOnce((key, value) => {
    void originalSet(key, value);
    startWrite();
    return pendingWrite;
  });
  await act(async () => {
    draft.save("旧会话");
    await writing;
    const clearing = draft.clear();
    invalidatePrivateStorage(1); activatePrivateStorage(1);
    await AsyncStorage.setItem("@test-draft:user:1", JSON.stringify("新会话"));
    finishWrite(); await clearing;
  });
  expect(await AsyncStorage.getItem("@test-draft:user:1")).toBe(JSON.stringify("新会话"));
  setItem.mockImplementation(originalSet); await act(async () => { tree.unmount(); });
});
