import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
let mockParams: { recipeId?: number; planItem?: { planId: string; itemId: string; version: number } } = {};
let mockUser: { id: number } | null = { id: 1 };
const mockShopping = jest.fn();
const mockPlanSave = jest.fn();
const mockPreview = jest.fn();
const mockMembers = jest.fn();
const mockFetch = jest.fn(); const mockMine = jest.fn(); const mockRead = jest.fn(); const mockSave = jest.fn();
jest.mock("@react-native-async-storage/async-storage",() => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@/contexts/AuthContext",() => ({ useAuth: () => ({ user: mockUser }),useAuthFetch: () => mockFetch }));
jest.mock("@/components/Screen",() => ({ Screen: "View" }));
jest.mock("@/hooks/useSafeRouter",() => ({ useSafeSearchParams: () => mockParams,useSafeRouter: () => ({ back: jest.fn() }) }));
jest.mock("@/services/api/mealPlans",() => ({ mealPlansApi: { addShopping: (...args: unknown[]) => mockShopping(...args),updateItem: (...args: unknown[]) => mockPlanSave(...args) } }));
jest.mock("@/services/api/households",() => ({ householdApi: { previewDiningAllocation: (...args: unknown[]) => mockPreview(...args), diningMembers: (...args: unknown[]) => mockMembers(...args), mine: (...args: unknown[]) => mockMine(...args),diningPreferences: (...args: unknown[]) => mockRead(...args),saveDiningPreferences: (...args: unknown[]) => mockSave(...args) } }));
import HouseholdDiningScreen from "./index";
const initial = { membershipId: 3,version: 1,shared: false,allergies: [],restrictions: [] };
const button = (tree: renderer.ReactTestRenderer,label: string) => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!;
beforeEach(() => { jest.resetAllMocks(); mockParams = {}; mockMembers.mockResolvedValue({ members: [{ membershipId: 9,userId: 4,name: "未授权成员",version: 1,shared: false }] }); mockUser = { id: 1 }; mockMine.mockResolvedValue([{ id: 8,name: "家庭甲" },{ id: 9,name: "家庭乙" }]); mockRead.mockResolvedValue(initial); });
test("saves explicit consent and own membership version, then requires reread after uncertain write",async () => {
  mockSave.mockRejectedValue(new Error("offline"));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdDiningScreen />); });
  expect(JSON.stringify(tree.toJSON())).toContain("未授权共享，忌口待本人确认");
  expect(tree.root.findByProps({ accessibilityLabel: "允许共餐共享" }).props.value).toBe(false);
  act(() => { tree.root.findAllByType(TextInput)[0].props.onChangeText("花生\n 花生 \n虾"); tree.root.findByProps({ accessibilityLabel: "允许共餐共享" }).props.onValueChange(true); });
  await act(async () => { button(tree,"保存共餐设置").props.onPress(); });
  expect(mockSave).toHaveBeenCalledWith(mockFetch,8,{ ...initial,shared: true,allergies: ["花生","虾"] });
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain("保存结果尚未确认");
  await act(async () => { button(tree,"重新读取设置").props.onPress(); });
  expect(tree.root.findByProps({ accessibilityLabel: "允许共餐共享" }).props.value).toBe(false);
  act(() => tree.unmount());
// The first render also loads React Native host components on cold Windows CI.
}, 15000);
test("switching families drops a late private response",async () => {
  let resolve!: (value: unknown) => void;
  mockRead.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdDiningScreen />); });
  await act(async () => { button(tree,"家庭乙").props.onPress(); });
  await act(async () => { resolve({ ...initial,allergies: ["旧家庭的过敏原"] }); });
  expect(tree.root.findAllByType(TextInput)[0].props.value).toBe("");
  act(() => tree.unmount());
});
test("account changes discard drafts and late saves, including when the family id is the same",async () => {
  let resolve!: (value: unknown) => void;
  mockSave.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdDiningScreen />); });
  act(() => { tree.root.findAllByType(TextInput)[0].props.onChangeText("账号甲的过敏原"); });
  await act(async () => { button(tree,"保存共餐设置").props.onPress(); });
  mockUser = { id: 2 };
  await act(async () => { tree.update(<HouseholdDiningScreen />); });
  await act(async () => { resolve({ ...initial,allergies: ["账号甲的过敏原"],shared: true }); });
  expect(tree.root.findAllByType(TextInput)[0].props.value).toBe("");
  expect(tree.root.findByProps({ accessibilityLabel: "允许共餐共享" }).props.value).toBe(false);
  mockUser = null;
  await act(async () => { tree.update(<HouseholdDiningScreen />); });
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  act(() => tree.unmount());
});
test("late shared member data does not appear after changing account",async () => {
  let resolve!: (value: unknown) => void;
  mockMembers.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdDiningScreen />); });
  mockUser = { id: 2 };
  await act(async () => { tree.update(<HouseholdDiningScreen />); });
  await act(async () => { resolve({ members: [{ membershipId: 99,userId: 99,name: "旧家庭成员",version: 1,shared: true,allergies: ["旧家庭过敏原"],restrictions: [] }] }); });
  expect(JSON.stringify(tree.toJSON())).not.toContain("旧家庭");
  expect(JSON.stringify(tree.toJSON())).toContain("未授权成员");
  act(() => tree.unmount());
});

test("selects participants explicitly and checks the chosen recipe without recording intake",async () => {
  mockParams = { recipeId: 7 };
  mockMembers.mockResolvedValue({ members: [1,2,3].map(id => ({ membershipId: id,userId: id,name: `成员${id}`,version: 2,shared: true,allergies: [],restrictions: [] })) });
  mockPreview.mockResolvedValue({ recipeCheck: { materials: { status: "known",demands: [{ food_name: "花生",amount_value: 300,unit: "g" }] },title: "花生菜",status: "blocked",conflicts: [{ membershipId: 2,constraint: "花生" }],checks: [] },totalServings: 3,participants: [1,2,3].map(id => ({ membershipId: id,name: `成员${id}`,servings: 1 })),allergies: ["花生"],restrictions: ["素食"] });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdDiningScreen />); });
  act(() => { for (const id of [1,2,3]) tree.root.findByProps({ accessibilityLabel: `成员${id}参与共餐` }).props.onValueChange(true); });
  await act(async () => { button(tree,"核算共餐需求").props.onPress(); });
  expect(mockPreview).toHaveBeenCalledWith(mockFetch,8,{ recipeId: 7,participants: [1,2,3].map(id => ({ membershipId: id,version: 2,servings: 1 })) });
  expect(mockSave).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("有已知忌口冲突");
  expect(JSON.stringify(tree.toJSON())).toContain("花生");
  act(() => { tree.root.findByProps({ accessibilityLabel: "成员3参与共餐" }).props.onValueChange(false); });
  expect(JSON.stringify(tree.toJSON())).not.toContain("需避开的过敏原");
  act(() => tree.unmount());
});


test("passes the selected personal meal version and labels the result as unapplied",async () => {
  const planItem = { planId: "plan",itemId: "meal",version: 4 };
  mockParams = { planItem };
  mockMembers.mockResolvedValue({ members: [{ membershipId: 1,userId: 1,name: "成员1",version: 2,shared: true,allergies: [],restrictions: [] }] });
  mockPreview.mockResolvedValue({ planItem: { ...planItem,plannedDate: "2036-09-12",mealType: "lunch",title: "原午餐",decision: "suggest",applied: false },totalServings: 1,participants: [{ membershipId: 1,name: "成员1",servings: 1 }],allergies: [],restrictions: [] });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdDiningScreen />); });
  act(() => tree.root.findByProps({ accessibilityLabel: "成员1参与共餐" }).props.onValueChange(true));
  await act(async () => { button(tree,"核算共餐需求").props.onPress(); });
  expect(mockPreview).toHaveBeenCalledWith(mockFetch,8,{ planItem,participants: [{ membershipId: 1,version: 2,servings: 1 }] });
  expect(JSON.stringify(tree.toJSON())).toContain("需要先审阅变更建议");
  expect(mockSave).not.toHaveBeenCalled();
  act(() => tree.unmount());
});


test("saves only after explicit review and presents a protected meal suggestion",async () => {
  const planItem = { planId: "plan",itemId: "meal",version: 4 };
  mockParams = { planItem };
  const person = { membershipId: 1,userId: 1,name: "成员1",version: 2,shared: true,allergies: [],restrictions: [],servings: 1 };
  mockMembers.mockResolvedValue({ members: [person] });
  mockPreview.mockResolvedValue({ planItem: { ...planItem,plannedDate: "2036-09-12",mealType: "lunch",title: "原午餐",decision: "suggest",applied: false },recipeCheck: { title: "原午餐",status: "needs_review",materials: { status: "unknown",demands: [] },conflicts: [],checks: [] },totalServings: 1,participants: [person],allergies: [],restrictions: [] });
  mockPlanSave.mockResolvedValue({ change: { status: "pending" } });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdDiningScreen />); });
  act(() => tree.root.findByProps({ accessibilityLabel: "成员1参与共餐" }).props.onValueChange(true));
  await act(async () => { button(tree,"核算共餐需求").props.onPress(); });
  expect(button(tree,"保存这餐的共餐安排").props.disabled).toBe(true);
  act(() => tree.root.findByProps({ accessibilityLabel: "已核对共餐限制" }).props.onValueChange(true));
  await act(async () => { button(tree,"保存这餐的共餐安排").props.onPress(); });
  expect(mockPlanSave).toHaveBeenCalledWith(mockFetch,"plan","meal",{ version: 4,dining: { householdId: 8,constraintsReviewed: true,participants: [{ membershipId: 1,version: 2,servings: 1 }] } });
  expect(JSON.stringify(tree.toJSON())).toContain("变更建议已保存");
  act(() => tree.unmount());
});

test("explicitly syncs reviewed total demand for the displayed saved meal version",async () => {
  const planItem = { planId: "plan",itemId: "meal",version: 4 };
  mockParams = { planItem };
  const person = { membershipId: 1,userId: 1,name: "成员1",version: 2,shared: true,allergies: [],restrictions: [],servings: 3 };
  mockMembers.mockResolvedValue({ members: [person] });
  mockPreview.mockResolvedValue({ planItem: { ...planItem,plannedDate: "2036-09-12",mealType: "lunch",title: "米饭",decision: "apply",applied: false },supply: { status: "known",otherMealCount: 1,demands: [{ food_name: "米",amount_value: 300,unit: "g",covered: 200,missing: 100,shoppingCovered: 50,unplanned: 50 }],checks: [] },recipeCheck: { fingerprint: "a".repeat(64),title: "米饭",status: "needs_review",materials: { status: "known",demands: [{ food_name: "米",amount_value: 300,unit: "g" }] },conflicts: [],checks: [] },totalServings: 3,participants: [person],allergies: [],restrictions: [] });
  mockShopping.mockResolvedValue({ added: 1,householdId: 8,mode: "total_demand" });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdDiningScreen />); });
  act(() => tree.root.findByProps({ accessibilityLabel: "成员1参与共餐" }).props.onValueChange(true));
  await act(async () => { button(tree,"核算共餐需求").props.onPress(); });
  expect(button(tree,"按此总需求同步家庭采购").props.disabled).toBe(true);
  act(() => tree.root.findByProps({ accessibilityLabel: "已核对共餐限制" }).props.onValueChange(true));
  await act(async () => { button(tree,"按此总需求同步家庭采购").props.onPress(); });
  expect(mockShopping).toHaveBeenCalledWith(mockFetch,"plan","meal",{ version: 4,idempotencyKey: `dining-shopping:meal:4:${"a".repeat(64)}`,householdRecipeFingerprint: "a".repeat(64),householdTotalDemand: { householdId: 8,constraintsReviewed: true,participants: [{ membershipId: 1,version: 2,servings: 3 }] } });
  expect(mockPlanSave).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("未扣除库存或其他采购");
  expect(JSON.stringify(tree.toJSON())).toContain("库存缺口 100 g");
  expect(JSON.stringify(tree.toJSON())).toContain("清单已列入 50 g，尚未安排 50 g");
  expect(JSON.stringify(tree.toJSON())).toContain("待吃成品不折算成原料");
  act(() => tree.unmount());
});

test("reviews net before and after quantities and retries the same snapshot after an uncertain write",async () => {
  mockParams = { planItem: { planId: "plan",itemId: "meal",version: 4 } };
  const person = { membershipId: 1,userId: 1,name: "成员1",version: 2,shared: true,allergies: [],restrictions: [],servings: 3 };
  mockMembers.mockResolvedValue({ members: [person] });
  mockPreview.mockResolvedValue({ planItem: { ...mockParams.planItem,plannedDate: "2036-09-12",mealType: "lunch",title: "米饭",decision: "apply",applied: false },supply: { status: "known",otherMealCount: 0,demands: [],checks: [],netShopping: { status: "ready",fingerprint: "b".repeat(64),checks: [],lines: [{ key: "rice",name: "大米",beforeAmount: "300g",afterAmount: "150g" }] } },recipeCheck: { fingerprint: "a".repeat(64),title: "米饭",status: "needs_review",materials: { status: "known",demands: [] },conflicts: [],checks: [] },totalServings: 3,participants: [person],allergies: [],restrictions: [] });
  mockShopping.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ added: 0 });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HouseholdDiningScreen />); });
  act(() => tree.root.findByProps({ accessibilityLabel: "成员1参与共餐" }).props.onValueChange(true));
  await act(async () => { button(tree,"核算共餐需求").props.onPress(); });
  expect(button(tree,"应用上述净采购调整").props.disabled).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain("300g");
  expect(JSON.stringify(tree.toJSON())).toContain("150g");
  act(() => tree.root.findByProps({ accessibilityLabel: "已核对共餐限制" }).props.onValueChange(true));
  await act(async () => { button(tree,"应用上述净采购调整").props.onPress(); });
  await act(async () => { button(tree,"应用上述净采购调整").props.onPress(); });
  expect(mockShopping.mock.calls[0]).toEqual(mockShopping.mock.calls[1]);
  expect(mockShopping.mock.calls[0][3]).toMatchObject({ householdNetFingerprint: "b".repeat(64),idempotencyKey: `dining-net:${"b".repeat(64)}` });
  expect(JSON.stringify(tree.toJSON())).toContain("净采购调整已应用");
  expect(mockPlanSave).not.toHaveBeenCalled();
  act(() => tree.unmount());
});
