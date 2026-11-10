import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import type { InterventionCard } from "@dietdigidose/contracts";

let mockAuth = { token: "one",user: { id: 1 } };
const mockCard = jest.fn();
const mockFeedback = jest.fn();
const mockRecipe = jest.fn();
jest.mock("@/components/Screen",() => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/contexts/AuthContext",() => ({ useAuth: () => mockAuth }));
jest.mock("@/hooks/useSafeRouter",() => ({ useSafeRouter: () => ({ push: jest.fn(),back: jest.fn(),replace: jest.fn(),canGoBack: () => true }),useSafeSearchParams: () => ({ id: "a".repeat(64) }) }));
jest.mock("@/services/api/interventions",() => ({ interventionApi: { feedback: (...args: unknown[]) => mockFeedback(...args), card: (...args: unknown[]) => mockCard(...args) } }));
jest.mock("@/services/api/recipes",() => ({ recipesApi: { detail: (...args: unknown[]) => mockRecipe(...args) } }));
jest.mock("./PlanRecipeAction", () => ({ PlanRecipeAction: () => null }));
jest.mock("./InventoryOutcomeAction", () => ({ InventoryOutcomeAction: () => null }));
import InterventionScreen from "./index";

const card = (title: string): InterventionCard => ({ id: "a".repeat(64),notificationId: 1,kind: "expiry_rescue",status: "inbox",title,body: "查看建议",whyNow: "食材将在三天内到期",expiresLabel: "今天结束前",expiresAt: "2099-09-12T10:00:00Z",localDate: "2099-09-12",inventoryIds: [1],recipeIds: [2],actions: ["plan_recipe"],policyVersion: "v1",decisionReason: "eligible" });

beforeEach(() => { mockAuth = { token: "one",user: { id: 1 } };mockCard.mockReset();mockRecipe.mockReset();mockRecipe.mockResolvedValue({ title: "番茄汤" }); });

test("account changes discard late private card responses", async () => {
  let oldResult!: (value: InterventionCard) => void;
  mockCard.mockImplementation((token: string) => token === "one" ? new Promise(resolve => { oldResult = resolve; }) : Promise.resolve(card("新账号提醒")));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<InterventionScreen />); });
  mockAuth = { token: "two",user: { id: 2 } };
  await act(async () => { tree.update(<InterventionScreen />); });
  expect(JSON.stringify(tree.toJSON())).toContain("新账号提醒");
  await act(async () => { oldResult(card("旧账号私密提醒")); });
  expect(JSON.stringify(tree.toJSON())).not.toContain("旧账号私密提醒");
  expect(JSON.stringify(tree.toJSON())).toContain("食材将在三天内到期");
  act(() => tree.unmount());
});

test("failed cards can be retried and expired advice is clearly identified", async () => {
  mockCard.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ...card("历史提醒"),status: "expired",actions: [] });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<InterventionScreen />); });
  const retry = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === "重新加载"))!;
  expect(retry).toBeDefined();
  await act(async () => { retry.props.onPress(); });
  expect(JSON.stringify(tree.toJSON())).toContain("这次建议已失效");
  expect(mockCard).toHaveBeenCalledTimes(2);
  act(() => tree.unmount());
});


test("feedback requires confirmation and reuses identity after response loss", async () => {
  mockCard.mockResolvedValue({ ...card("提醒"), actions: ["snooze"] });
  mockFeedback.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ repeated: true });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<InterventionScreen />); });
  const click = async (label: string) => { const button = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!; await act(async () => { button.props.onPress(); }); };
  await click("明天再提醒");
  expect(mockFeedback).not.toHaveBeenCalled();
  await click("确认反馈");
  expect(JSON.stringify(tree.toJSON())).toContain("network");
  await click("确认反馈");
  expect(mockFeedback.mock.calls[0][2]).toEqual(mockFeedback.mock.calls[1][2]);
  expect(JSON.stringify(tree.toJSON())).toContain("这条提醒已处理");
  act(() => tree.unmount());
});
