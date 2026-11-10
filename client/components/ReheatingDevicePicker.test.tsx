import React from "react";
import renderer, { act } from "react-test-renderer";
import { TouchableOpacity } from "react-native";
const mockList = jest.fn();
const mockFetch = jest.fn();
let mockUser: { id: number } | null = { id: 1 };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }), useAuthFetch: () => mockFetch }));
jest.mock("@/services/api/inventory", () => ({ kitchenwareApi: { list: (...args: unknown[]) => mockList(...args) } }));
import { ReheatingDevicePicker } from "./ReheatingDevicePicker";

beforeEach(() => { jest.clearAllMocks(); mockUser = { id: 1 }; });
test("requires an explicit selection and clears a device when unchecked", async () => {
  mockList.mockResolvedValue([{ id: 7, name: "食用地点微波炉" }]);
  const change = jest.fn(); let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ReheatingDevicePicker onChange={change} />); });
  expect(change).not.toHaveBeenCalled();
  act(() => tree.root.findByType(TouchableOpacity).props.onPress()); expect(change).toHaveBeenLastCalledWith([7]);
  act(() => tree.update(<ReheatingDevicePicker value={[7]} onChange={change} />));
  act(() => tree.root.findByType(TouchableOpacity).props.onPress()); expect(change).toHaveBeenLastCalledWith([]);
  act(() => tree.unmount());
});
test("does not show a previous account's devices after a delayed load", async () => {
  let resolve!: (value: unknown) => void;
  mockList.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce([{ id: 8, name: "当前设备" }]);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ReheatingDevicePicker onChange={jest.fn()} />); });
  mockUser = { id: 2 };
  await act(async () => { tree.update(<ReheatingDevicePicker onChange={jest.fn()} />); });
  await act(async () => { resolve([{ id: 7, name: "上个账号设备" }]); });
  expect(JSON.stringify(tree.toJSON())).toContain("当前设备"); expect(JSON.stringify(tree.toJSON())).not.toContain("上个账号设备");
  act(() => tree.unmount());
});
