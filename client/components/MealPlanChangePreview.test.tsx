import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
const mockPreview = jest.fn();
const mockFetch = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({ useAuthFetch: () => mockFetch }));
jest.mock("@/services/api", () => ({ mealPlansApi: { changePreview: (...args: unknown[]) => mockPreview(...args) } }));
import { MealPlanChangePreview } from "./MealPlanChangePreview";
const input = { patch: { version: 2, recipeId: 42 } };
const result = { fingerprint: "proof", planVersion: 3, itemVersion: 2, canApply: true, scope: { kind: "current_plan_window", startDate: "2026-10-21", endDate: "2026-10-23" }, checks: [] };
function button(tree: renderer.ReactTestRenderer, label: string) { return tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!; }
beforeEach(() => { jest.clearAllMocks(); mockPreview.mockResolvedValue(result); });
test("blocked checks preserve original arrangement and disable submission", async () => {
  mockPreview.mockResolvedValue({ ...result, canApply: false, checks: [{ code: "missing_evidence", severity: "blocked", itemIds: ["item"], message: "缺少原料证据" }] });
  const apply = jest.fn(); let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChangePreview planId="plan" itemId="item" input={input} title="替换" onApply={apply} onCancel={jest.fn()} />); });
  expect(JSON.stringify(tree.toJSON())).toContain("缺少原料证据");
  expect(JSON.stringify(tree.toJSON())).toContain("不代表窗外保证");
  expect(button(tree,"确认应用").props.disabled).toBe(true);
  await act(async () => { button(tree,"确认应用").props.onPress(); });
  expect(apply).not.toHaveBeenCalled(); act(() => tree.unmount());
});
test("only confirms once, passes fingerprint and requires revalidation after failure", async () => {
  let reject!: (error: Error) => void;
  const apply = jest.fn(() => new Promise<void>((_, fail) => { reject = fail; })); let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChangePreview planId="plan" itemId="item" input={input} title="替换" onApply={apply} onCancel={jest.fn()} />); });
  expect(apply).not.toHaveBeenCalled();
  const press = button(tree,"确认应用").props.onPress;
  await act(async () => { press(); press(); });
  expect(apply).toHaveBeenCalledTimes(1); expect(apply).toHaveBeenCalledWith("proof");
  expect(button(tree,"取消").props.disabled).toBe(true);
  await act(async () => { reject(new Error("库存已变化")); });
  expect(button(tree,"确认应用").props.disabled).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain("库存已变化");
  await act(async () => { button(tree,"重新验证").props.onPress(); });
  expect(mockPreview).toHaveBeenCalledTimes(2); act(() => tree.unmount());
});
test("late response from a superseded proposal cannot enable confirmation", async () => {
  let resolve!: (value: typeof result) => void;
  mockPreview.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mockPreview.mockResolvedValueOnce({ ...result, canApply: false });
  const apply = jest.fn(); const cancel = jest.fn(); let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChangePreview planId="plan" itemId="item" input={input} title="替换" onApply={apply} onCancel={cancel} />); });
  expect(button(tree,"确认应用").props.disabled).toBe(true);
  await act(async () => { tree.update(<MealPlanChangePreview planId="plan" itemId="other" input={{ patch: { version: 4, recipeId: 43 } }} title="替换" onApply={apply} onCancel={cancel} />); });
  await act(async () => { resolve(result); });
  expect(button(tree,"确认应用").props.disabled).toBe(true);
  act(() => { button(tree,"取消").props.onPress(); }); expect(cancel).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled(); act(() => tree.unmount());
});

test("successful empty-check preview shows ingredient coverage and time evidence", async () => {
  mockPreview.mockResolvedValue({ ...result, ingredientBudget: [{ food_name: "米", requested_value: 100, covered_value: 100, missing_value: 0, unit: "g", fully_covered: true, quantity_status: "sufficient" }], time: { knownSequentialMinutes: 25, budgetMinutes: 40, sessionBudgetMinutes: 30, incomplete: false, exceedsBudget: false, isEstimate: true, missing: [] } });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChangePreview planId="plan" itemId="item" input={input} title="替换" onApply={jest.fn()} onCancel={jest.fn()} />); });
  const output = JSON.stringify(tree.toJSON());
  expect(output).toContain("同日期窗其他已激活安排");
  expect(output).toContain("不等同采购清单范围");
  expect(output).toContain("已验证覆盖 1/1 项原料需求");
  expect(output).toContain("已知顺序制作约 25 分钟；整套预算 40 分钟；单次预算 30 分钟");
  expect(output).toContain("时间与设备依据完整");
  expect(output).toContain("服务端验证通过");
  act(() => tree.unmount());
});
test("incomplete evidence is visible rather than presented as full coverage or timing guarantee", async () => {
  mockPreview.mockResolvedValue({ ...result, canApply: false, ingredientBudget: [{ food_name: "米", requested_value: 100, covered_value: 0, missing_value: 100, unit: "g", fully_covered: false, quantity_status: "unknown" }], time: { knownSequentialMinutes: 25, budgetMinutes: 20, incomplete: true, exceedsBudget: true, isEstimate: true, missing: ["设备容量待核对"] } });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChangePreview planId="plan" itemId="item" input={input} title="替换" onApply={jest.fn()} onCancel={jest.fn()} />); });
  const output = JSON.stringify(tree.toJSON());
  expect(output).toContain("已验证覆盖 0/1 项原料需求，1 项数量待核对");
  expect(output).toContain("时间或设备依据尚不完整");
  expect(output).toContain("超过时间上限");
  expect(output).toContain("设备容量待核对");
  expect(button(tree,"确认应用").props.disabled).toBe(true);
  act(() => tree.unmount());
});
