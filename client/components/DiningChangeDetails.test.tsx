import React from "react";
import renderer, { act } from "react-test-renderer";
const mockMembers = jest.fn();
const mockFetch = jest.fn();
jest.mock("@/contexts/AuthContext",() => ({ useAuthFetch: () => mockFetch }));
jest.mock("@/services/api/households",() => ({ householdApi: { diningMembers: (...args: unknown[]) => mockMembers(...args) } }));
import { DiningChangeDetails } from "./DiningChangeDetails";
test("shows the changed participants with current membership names and individual portions",async () => {
  mockMembers.mockResolvedValue({ members: [{ membershipId: 7,name: "甲" },{ membershipId: 8,name: "乙" }] });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<DiningChangeDetails label="变更后" dining={{ householdId: 4,constraintsReviewed: true,participants: [{ membershipId: 7,version: 2,servings: 1 },{ membershipId: 8,version: 3,servings: 0.5 }] }} />); });
  expect(mockMembers).toHaveBeenCalledWith(mockFetch,4);
  const output = JSON.stringify(tree.toJSON()); expect(output).toContain("甲"); expect(output).toContain("乙"); expect(output).toContain("0.5");
  act(() => tree.unmount());
});
