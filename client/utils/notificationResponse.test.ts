import {
  getExpiringNotificationAction,
  resolveNotificationDestination,
} from "./notificationResponse";

describe("notification response routing", () => {
  it("does not redirect ordinary startup for an empty or unknown response", () => {
    expect(resolveNotificationDestination({}, "default")).toBeNull();
    expect(resolveNotificationDestination({ type: "unknown" }, "default")).toBeNull();
  });

  it("routes supported notification payloads", () => {
    expect(resolveNotificationDestination({ type: "routine_reminder", kind: "meal" }, "default"))
      .toEqual({ pathname: "/diet-record" });
    expect(resolveNotificationDestination({ type: "routine_reminder", kind: "water" }, "default"))
      .toEqual({ pathname: "/notifications" });
    expect(resolveNotificationDestination({ type: "admin_campaign" }, "default"))
      .toEqual({ pathname: "/notifications" });
    expect(resolveNotificationDestination({
      type: "expiring_inventory",
      notificationId: 12,
      inventoryItemId: 34,
    }, "default")).toEqual({
      pathname: "/(tabs)/inventory",
      params: { highlightItemId: 34 },
    });
    expect(resolveNotificationDestination({ type: "cooking_reminder", recipeId: 8 }, "default"))
      .toEqual({ pathname: "/cooking-queue", params: { highlightRecipeId: 8 } });
    expect(resolveNotificationDestination({ type: "cooking_reminder", recipeId: 8 }, "START_COOKING"))
      .toEqual({ pathname: "/cooking-queue", params: { highlightRecipeId: 8 } });
  });

  it("preserves expiring inventory actions", () => {
    expect(getExpiringNotificationAction("COMPLETE")).toBe("complete");
    expect(getExpiringNotificationAction("PLAN_RECIPE")).toBe("plan_recipe");
    expect(getExpiringNotificationAction("default")).toBe("open");
    expect(resolveNotificationDestination({
      type: "expiring_inventory",
      notificationId: 12,
      inventoryItemId: 34,
    }, "COMPLETE")).toBeNull();
  });
});

describe("proactive intervention navigation", () => {
  it("opens the owned-card route without treating a push action as an inventory write", () => {
    const id = "a".repeat(64);
    expect(resolveNotificationDestination({ type: "proactive_intervention",interventionId: id },"COMPLETE")).toEqual({ pathname: "/intervention",params: { id } });
    expect(resolveNotificationDestination({ type: "proactive_intervention",interventionId: "invalid" },"DEFAULT")).toEqual({ pathname: "/notifications" });
  });
});


test("cooking notification actions select the exact queue task and always re-enter current validation", () => {
  const queueItemId = "00000000-0000-4000-8000-000000000001";
  for (const action of ["default", "START_COOKING"]) {
    expect(resolveNotificationDestination({ type: "cooking_reminder", recipeId: 8, queueItemId }, action)).toEqual({ pathname: "/cooking-queue", params: { highlightRecipeId: 8, highlightQueueItemId: queueItemId } });
    expect(resolveNotificationDestination({ type: "cooking_reminder", recipeId: 8, queueItemId: "invalid" }, action)).toEqual({ pathname: "/cooking-queue", params: { highlightRecipeId: 8 } });
  }
});
