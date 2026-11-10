import React from "react";
import renderer, { act } from "react-test-renderer";
import { useHealthSummary } from "./useHealthSummary";

const mockProfile = jest.fn(); const mockFetch = jest.fn(); let mockUser: { id: number } | null = { id: 1 };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }), useAuthFetch: () => mockFetch }));
jest.mock("@/services/api/health", () => ({ healthApi: { profile: (...args: unknown[]) => mockProfile(...args) } }));
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]) }));
let summary!: ReturnType<typeof useHealthSummary>;
function Probe() { const value = useHealthSummary(); React.useLayoutEffect(() => { summary = value; }); return null; }
beforeEach(() => { mockUser = { id: 1 }; mockProfile.mockReset(); });

test.each([["user", "每日目标"], ["legacy_unconfirmed", "旧版目标，待确认"], ["unset", "系统参考，尚未设置目标"]])("renders the canonical %s target with its source", async (source, label) => {
  mockProfile.mockResolvedValue({ calorieTarget: { value: source === "unset" ? null : 1750, source, referenceValue: 2000 } });
  let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(<Probe />); });
  expect(summary.targetCalories).toBe(source === "unset" ? 2000 : 1750); expect(summary.targetLabel).toBe(label);
  await act(async () => { tree.unmount(); });
});

test("a delayed previous-account target cannot leak into the new account", async () => {
  let resolve!: (value: unknown) => void;
  mockProfile.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue({ calorieTarget: { value: 1800, source: "user" } });
  let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(<Probe />); });
  mockUser = { id: 2 }; await act(async () => { tree.update(<Probe />); });
  await act(async () => { resolve({ calorieTarget: { value: 2500, source: "user" } }); });
  expect(summary.targetCalories).toBe(1800);
  mockUser = null; await act(async () => { tree.update(<Probe />); });
  expect(summary.profile).toBeNull(); expect(summary.targetLabel).toContain("系统参考");
  await act(async () => { tree.unmount(); });
});
