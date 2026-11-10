import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import type { InterventionCard } from "@dietdigidose/contracts";
const mockFetch = jest.fn();
const mockRecord = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({ useAuthFetch: () => mockFetch }));
jest.mock("@/services/api/inventory", () => ({ inventoryApi: { list: async () => [
  { id: 1, version: 3, food_name: "番茄", quantity: "500g", is_available: true },
  { id: 2, version: 1, food_name: "牛奶", quantity: "1瓶", is_available: true },
] } }));
jest.mock("@/services/api/insights", () => ({ insightsApi: { recordOutcome: (...args: unknown[]) => mockRecord(...args) } }));
import { InventoryOutcomeAction } from "./InventoryOutcomeAction";
test("an explicit item confirmation never closes the entire candidate group and retries preserve identity", async () => {
  const done = jest.fn();
  const card = { id: "a".repeat(64), inventoryIds: [1,2], actions: ["mark_consumed", "mark_discarded"] } as InterventionCard;
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<InventoryOutcomeAction card={card} onDone={done} />); });
  const buttons = (label: string) => tree.root.findAllByType(TouchableOpacity).filter(node => node.findAllByType(Text).some(text => text.props.children === label));
  await act(async () => { buttons("整批已丢弃")[0].props.onPress(); });
  expect(mockRecord).not.toHaveBeenCalled();
  mockRecord.mockRejectedValueOnce(new Error("response lost"));
  await act(async () => { buttons("确认这一批的结果")[0].props.onPress(); });
  expect(done).not.toHaveBeenCalled();
  mockRecord.mockResolvedValueOnce({ repeated: true });
  await act(async () => { buttons("确认这一批的结果")[0].props.onPress(); });
  expect(mockRecord.mock.calls[0][1]).toEqual(mockRecord.mock.calls[1][1]);
  expect(mockRecord.mock.calls[1][1]).toMatchObject({ itemId: 1, itemVersion: 3, outcome: "discarded", confirmed: true, closeItem: true });
  expect(mockRecord.mock.calls[1][1]).not.toHaveProperty("items");
  expect(done).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});
