const mockRequestJson = jest.fn();
jest.mock("../client", () => ({ requestJson: (...args: unknown[]) => mockRequestJson(...args) }));
import { mealPlansApi } from "../mealPlans";
const fetcher = jest.fn();
beforeEach(() => jest.clearAllMocks());
test("preview posts the immutable patch to the item endpoint", () => {
  const patch = { version: 3, recipeId: 8, plannedDate: "2026-10-22", mealType: "午餐" };
  mealPlansApi.changePreview(fetcher, "plan/id", "item/id", { patch });
  expect(mockRequestJson).toHaveBeenCalledWith(fetcher, "/api/v1/meal-plans/plan%2Fid/items/item%2Fid/change-preview", { method: "POST", body: JSON.stringify({ patch }) });
});
test("the original patch and fingerprint are submitted without being dropped", () => {
  const patch = { version: 3, recipeId: 8, validationFingerprint: "proof" };
  mealPlansApi.updateItem(fetcher, "plan", "item", patch);
  expect(mockRequestJson).toHaveBeenCalledWith(fetcher, "/api/v1/meal-plans/plan/items/item", { method: "PATCH", body: JSON.stringify(patch) });
});
test.each(["accept", "restore"] as const)("%s review submits its fingerprint", action => {
  mealPlansApi.reviewChange(fetcher, "plan", "change", action, "proof");
  expect(mockRequestJson).toHaveBeenCalledWith(fetcher, "/api/v1/meal-plans/plan/changes/change/review", { method: "POST", body: JSON.stringify({ action, validationFingerprint: "proof" }) });
});
