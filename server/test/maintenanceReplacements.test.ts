import assert from "node:assert/strict";
import { test } from "node:test";
import { selectMaintenanceReplacements } from "../src/modules/planMaintenance/replacements.js";
import type { MaintenanceInputSnapshot } from "../src/modules/planMaintenance/inputSnapshot.js";
import type { MaintenanceScope } from "../src/modules/planMaintenance/scope.js";
import type { Row } from "../src/modules/mealPlans/formatters.js";

function fixture() {
  const snapshot: MaintenanceInputSnapshot = { fingerprint: "input",recipeIds: [1,2],data: {
    meal_plans: [{ id: "plan",status: "active",version: 1,constraints_json: { executionItems: { a: { servings: 1 },b: { servings: 1 } } } }],
    meal_plan_items: ["a","b"].map(id => ({ id,plan_id: "plan",planned_date: "2026-09-12",meal_type: "午餐",status: "planned",version: 1,recipe_id: 1,ingredients_json: [{ name: "鸡蛋",amount: "2个" }] })),
    inventory_items: [{ id: 10,food_name: "大米",quantity_value: 150,quantity_unit: "g",is_available: 1,version: 1,expiration_date: "2026-09-20" }],
    kitchenware_items: [],user_health_profiles: [],
    recipes: [
      { id: 1,title: "蛋羹",status: "approved",serving_size: 1,cook_time: 5,prep_time: 1,ingredients_json: [{ name: "鸡蛋",amount: "2个" }] },
      { id: 2,title: "米饭",status: "approved",serving_size: 1,cook_time: 5,prep_time: 1,ingredients_json: [{ name: "大米",amount: "100g" }] },
    ],
  } };
  const scope: MaintenanceScope = { items: ["a","b"].map(itemId => ({ itemId,planId: "plan",version: 1,planVersion: 1,eventIds: ["event"] })),preparedTargets: [],checks: [] };
  const compatibility = new Map<number,{ requirements: Row[]; blocking: Row[] }>([1,2].map(id => [id,{ requirements: [],blocking: [] }]));
  return { snapshot,scope,compatibility };
}

test("replacement solves a shortage without assigning the same stock twice", () => {
  const { snapshot,scope,compatibility } = fixture(); const original = structuredClone(snapshot);
  const result = selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12");
  assert.equal(result.changes.length,1); assert.equal(result.changes[0].itemId,"a"); assert.equal(result.changes[0].input.recipeId,2);
  assert.ok(result.checks.some(check => check.includes("餐次 b")));
  assert.deepEqual(snapshot,original);
});

test("shared dining remains a review check without blocking other meal replacements", () => {
  const { snapshot,scope,compatibility } = fixture();
  snapshot.data.meal_plan_items[0].dining_json = { householdId: 1,participants: [{ membershipId: 1,version: 1,servings: 1 }] };
  const original = structuredClone(snapshot);
  const result = selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12");
  assert.deepEqual(result.changes.map(change => change.itemId),["b"]);
  assert.ok(result.checks.some(check => check.includes("餐次 a 的共餐安排")));
  assert.deepEqual(snapshot,original);
});

test("allergy, missing required tools and conditional substitutions block automatic selection", () => {
  const { snapshot,scope,compatibility } = fixture();
  snapshot.data.user_health_profiles = [{ allergies_json: [{ name: "大米" }] }];
  assert.equal(selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12").changes.length,0);
  snapshot.data.user_health_profiles = [];
  compatibility.set(2,{ requirements: [{ role: "required" }],blocking: [{ catalogName: "蒸锅" }] });
  assert.equal(selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12").changes.length,0);
  compatibility.set(2,{ requirements: [{ role: "required",substitution: { relationType: "conditional" } }],blocking: [] });
  assert.equal(selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12").changes.length,0);
});

test("fixed meals retain their inventory and cooking meals are never replaced", () => {
  const { snapshot,scope,compatibility } = fixture();
  snapshot.data.meal_plan_items[1].recipe_id = 2;
  snapshot.data.meal_plan_items[1].ingredients_json = [{ name: "大米",amount: "100g" }];
  snapshot.data.meal_plan_items[1].status = "cooking";
  assert.equal(selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12").changes.length,0);
});

test("known portions scale alternatives while unknown preparation or explicit budget remains a check", () => {
  const { snapshot,scope,compatibility } = fixture(); snapshot.data.meal_plan_items.pop(); scope.items.pop();
  snapshot.data.meal_plans[0].constraints_json = { executionItems: { a: { servings: 1.5 } } };
  snapshot.data.recipes[1].serving_size = 2;
  snapshot.data.recipes[1].ingredients_json = [{ name: "大米",amount: "200g" }];
  assert.equal(selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12").changes.length,1);
  snapshot.data.recipes[1].prep_time = null;
  assert.equal(selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12").changes.length,0);
  snapshot.data.recipes[1].prep_time = 1;
  snapshot.data.user_health_profiles = [{ kitchen_constraints_json: { budget_per_meal: 10 } }];
  assert.equal(selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12").changes.length,0);
});

test("already covered meals produce no replacement", () => {
  const { snapshot,scope,compatibility } = fixture();
  snapshot.data.inventory_items.push({ id: 11,food_name: "鸡蛋",quantity_value: 4,quantity_unit: "piece",is_available: 1,version: 1,expiration_date: "2026-09-20" });
  assert.deepEqual(selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12"),{ changes: [],checks: [] });
});


test("replacement respects the number of batches required by planned portions", () => {
  const { snapshot,scope,compatibility } = fixture();
  snapshot.data.meal_plan_items.pop(); scope.items.pop();
  snapshot.data.meal_plans[0].constraints_json = { executionItems: { a: { servings: 3 } } };
  snapshot.data.inventory_items[0].quantity_value = 500;
  snapshot.data.user_health_profiles = [{ kitchen_constraints_json: { meal_time_minutes: 12 } }];
  assert.equal(selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12").changes.length,0);
  snapshot.data.user_health_profiles = [{ kitchen_constraints_json: { meal_time_minutes: 20 } }];
  const result = selectMaintenanceReplacements(snapshot,scope,compatibility,"2026-09-12");
  assert.equal(result.changes.length,1);
  assert.ok(result.checks.some(check => check.includes("18 分钟") && check.includes("设备容量")));
});
