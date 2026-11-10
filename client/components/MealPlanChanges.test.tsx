jest.mock("@/services/api/households",() => ({ householdApi: { diningMembers: async () => ({ members: [] }) } }));
import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
let mockUserId = 1;
const mockChanges = jest.fn();
const mockReview = jest.fn();
const mockPreview = jest.fn();
const mockFetch = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: mockUserId }, isAuthenticated: true }), useAuthFetch: () => mockFetch }));
jest.mock("@/services/api", () => ({ mealPlansApi: { changePreview: (...args: unknown[]) => mockPreview(...args), changes: (...args: unknown[]) => mockChanges(...args), reviewChange: (...args: unknown[]) => mockReview(...args) } }));
import { MealPlanChanges } from "./MealPlanChanges";
const suggestion = { id: "change", itemId: "item", reason: "用餐条件变化", source: "worker", status: "pending", before: { title: "旧菜", input: { plannedDate: "2026-09-12", mealType: "午餐", recipeId: 1 } }, after: { plannedDate: "2026-09-13", recipeId: 2, title: "新菜" } };
function press(tree: renderer.ReactTestRenderer, label: string) { tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!.props.onPress(); }
const preview = { fingerprint: "proof", planVersion: 1, itemVersion: 1, canApply: true, scope: { kind: "current_plan_window", startDate: "2026-09-12", endDate: "2026-09-14" }, checks: [] };
beforeEach(() => { jest.clearAllMocks(); mockUserId = 1; mockPreview.mockResolvedValue(preview); });
test("shows concrete before/after and applies only when the user accepts", async () => {
  mockChanges.mockResolvedValueOnce([suggestion]).mockResolvedValueOnce([{ ...suggestion,status: "applied" }]);
  mockReview.mockResolvedValue({ id: "item",version: 2 });
  const onChanged = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChanges planId="plan" revision={0} items={[]} onChanged={onChanged} />); });
  expect(JSON.stringify(tree.toJSON())).toContain("旧菜 → 新菜");
  expect(mockReview).not.toHaveBeenCalled();
  await act(async () => { press(tree,"接受变更"); });
  expect(mockReview).not.toHaveBeenCalled();
  expect(mockPreview).toHaveBeenCalledWith(mockFetch,"plan","item",{ changeId: "change", action: "accept" });
  await act(async () => { press(tree,"确认应用"); });
  expect(mockReview).toHaveBeenCalledWith(mockFetch,"plan","change","accept","proof");
  expect(onChanged).toHaveBeenCalledWith({ id: "item",version: 2 });
  expect(JSON.stringify(tree.toJSON())).toContain("恢复变更前安排");
  act(() => tree.unmount());
});
test("conflict keeps the current plan and reports the server's reason", async () => {
  mockChanges.mockResolvedValue([suggestion]);
  mockReview.mockRejectedValue(new Error("制作状态已变化"));

  const onChanged = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChanges planId="plan" revision={0} items={[]} onChanged={onChanged} />); });
  await act(async () => { press(tree,"接受变更"); });
  await act(async () => { press(tree,"确认应用"); });
  expect(onChanged).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("制作状态已变化");
  act(() => tree.unmount());
});

test("reject keeps the direct review flow without preview", async () => {
  mockChanges.mockResolvedValue([suggestion]); mockReview.mockResolvedValue({ id: "item", version: 2 });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChanges planId="plan" revision={0} items={[]} onChanged={jest.fn()} />); });
  await act(async () => { press(tree,"保留原安排"); });
  expect(mockPreview).not.toHaveBeenCalled();
  expect(mockReview).toHaveBeenCalledWith(mockFetch,"plan","change","reject");
  act(() => tree.unmount());
});
test("restore previews the exact change before applying", async () => {
  mockChanges.mockResolvedValue([{ ...suggestion, status: "applied" }]);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChanges planId="plan" revision={0} items={[]} onChanged={jest.fn()} />); });
  await act(async () => { press(tree,"恢复变更前安排"); });
  expect(mockPreview).toHaveBeenCalledWith(mockFetch,"plan","item",{ changeId: "change", action: "restore" });
  expect(mockReview).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

test.each(["接受变更", "保留原安排"])("old-account %s response never calls onChanged after switch", async label => {
  let finishOld!: (value: unknown) => void;
  mockChanges.mockResolvedValue([suggestion]);
  mockReview.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
  const onChanged = jest.fn(); let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChanges planId="plan" revision={0} items={[]} onChanged={onChanged} />); });
  await act(async () => { press(tree, label); });
  if (label === "接受变更") await act(async () => { press(tree, "确认应用"); });
  mockUserId = 2;
  await act(async () => { tree.update(<MealPlanChanges planId="plan" revision={0} items={[]} onChanged={onChanged} />); });
  await act(async () => { press(tree, "接受变更"); });
  await act(async () => { finishOld({ id: "item", version: 2 }); });
  expect(onChanged).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("确认调整前验证");
  act(() => tree.unmount());
});
