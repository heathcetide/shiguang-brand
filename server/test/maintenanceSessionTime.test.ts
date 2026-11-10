import assert from "node:assert/strict";
import { test } from "node:test";
import { maintenanceSessionTime } from "../src/modules/planMaintenance/sessionTime.js";
import type { MaintenanceInputSnapshot } from "../src/modules/planMaintenance/inputSnapshot.js";
function fixture(): MaintenanceInputSnapshot {
  return { fingerprint: "input",recipeIds: [1],data: {
    meal_plans: [{ id: "plan",constraints_json: { executionItems: { a: { servings: 3 },b: { servings: 2 } } } }],
    meal_plan_items: ["a","b"].map(id => ({ id,plan_id: "plan",planned_date: "2026-09-12",meal_type: "午餐",recipe_id: 1,status: "planned" })),
    recipes: [{ id: 1,serving_size: 2,cook_time: 10,prep_time: 5 }],
  } };
}
test("session sums all planned batches and excludes completed or other sessions", () => {
  const snapshot = fixture(); const item = snapshot.data.meal_plan_items[0];
  snapshot.data.meal_plan_items.push({ ...item,id: "done",status: "completed" },{ ...item,id: "tomorrow",planned_date: "2026-09-13" });
  const result = maintenanceSessionTime(snapshot,item,40);
  assert.equal(result.knownSequentialMinutes,45); assert.equal(result.exceedsBudget,true);
  assert.equal(result.incomplete,true); assert.deepEqual(result.missing,["cleanup","equipment_capacity"]);
});
test("unknown production yield or preparation is never treated as zero-time certainty", () => {
  for (const patch of [{ serving_size: null },{ prep_time: null },{ prep_time: -1 },{ cook_time: Infinity }]) {
    const snapshot = fixture(); Object.assign(snapshot.data.recipes[0],patch);
    const result = maintenanceSessionTime(snapshot,snapshot.data.meal_plan_items[0],60);
    assert.equal(result.preparationOrCookingUnknown,true);
    assert.ok(result.missing.includes("preparation_or_cooking"));
  }
});
