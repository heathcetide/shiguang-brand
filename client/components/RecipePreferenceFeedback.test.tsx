import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
const mockRequest = jest.fn(); const mockFetch = jest.fn(); let mockUser = { id: 1 };
jest.mock("@/contexts/AuthContext",() => ({ useAuth: () => ({ user: mockUser }),useAuthFetch: () => mockFetch }));
jest.mock("@/hooks/useSafeRouter",() => ({ useSafeRouter: () => ({ push: jest.fn() }) }));
jest.mock("expo-crypto",() => ({ randomUUID: () => "feedback-stable-id" }));
jest.mock("@/services/api/client",() => ({ requestJson: (...args: unknown[]) => mockRequest(...args) }));
import { RecipePreferenceFeedback } from "./RecipePreferenceFeedback";
function press(tree: renderer.ReactTestRenderer,label: string) { tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!.props.onPress(); }
beforeEach(() => { jest.clearAllMocks(); mockUser = { id: 1 }; });
test.each([["今天没时间","no_time"],["份量太大","too_much"]])("%s records a temporary reason without changing taste",async (label,reason) => {
  mockRequest.mockResolvedValue({}); let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<RecipePreferenceFeedback recipeId={7} />); });
  await act(async () => { press(tree,label); });
  expect(mockRequest.mock.calls[0][1]).toBe("/api/v1/recommendations/events");
  expect(JSON.parse(mockRequest.mock.calls[0][2].body).metadata).toEqual({ reason,scope: "session",source: "recipe_detail" });
  act(() => tree.unmount());
});
test("uncertain explicit preference retries the same version without silently overwriting newer settings",async () => {
  mockRequest.mockResolvedValueOnce({ version: 4 }).mockRejectedValueOnce(new Error("断网")).mockResolvedValueOnce({});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<RecipePreferenceFeedback recipeId={7} />); });
  await act(async () => { press(tree,"长期不喜欢这道菜"); });
  await act(async () => { press(tree,"重试原反馈"); });
  expect(mockRequest.mock.calls[1][2]).toEqual(mockRequest.mock.calls[2][2]);
  expect(JSON.parse(mockRequest.mock.calls[2][2].body)).toEqual({ kind: "recipe",version: 4,recipeId: 7,value: "dislike" });
  act(() => tree.unmount());
});
test("account switch during preference read prevents writing the old user's choice",async () => {
  let resolve!: (value: unknown) => void; mockRequest.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<RecipePreferenceFeedback recipeId={7} />); });
  await act(async () => { press(tree,"长期不喜欢这道菜"); });
  mockUser = { id: 2 };
  await act(async () => { tree.update(<RecipePreferenceFeedback recipeId={7} />); });
  await act(async () => { resolve({ version: 1 }); });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});
