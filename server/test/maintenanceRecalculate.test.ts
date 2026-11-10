import assert from "node:assert/strict";
import { test } from "node:test";
import { recalculateMaintenanceQuantities } from "../src/modules/planMaintenance/recalculate.js";
import type { MaintenanceInputSnapshot } from "../src/modules/planMaintenance/inputSnapshot.js";
import type { MaintenanceScope } from "../src/modules/planMaintenance/scope.js";

function fixture() {
  const snapshot: MaintenanceInputSnapshot = { fingerprint: "input",recipeIds: [],data: {
    meal_plans: [{ id: "plan",status: "active" }],
    meal_plan_items: ["fixed","a","b"].map(id => ({ id,plan_id: "plan",planned_date: "2026-09-12",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "2个" }] })),
    inventory_items: [{ id: 1,food_name: "鸡蛋",quantity_value: 4,quantity_unit: "piece",is_available: 1,version: 1,expiration_date: "2026-09-20" }],
  } };
  const scope: MaintenanceScope = { items: ["a","b"].map(itemId => ({ itemId,planId: "plan",version: 1,planVersion: 1,eventIds: ["event"] })),preparedTargets: [],checks: [] };
  return { snapshot,scope };
}

test("fixed commitments reserve first and affected meals cannot reuse the same stock", () => {
  const { snapshot,scope } = fixture();
  const original = structuredClone(snapshot);
  const result = recalculateMaintenanceQuantities(snapshot,scope,"2026-09-12");
  assert.deepEqual(result.assessments.map(item => [item.itemId,item.status,item.requirements[0].covered]),[["a","covered",2],["b","missing",0]]);
  assert.deepEqual(snapshot,original);
  assert.equal(result.modelCalls,0); assert.equal(result.inputFingerprint,"input");
});

test("expired and estimated stock cannot be asserted as usable", () => {
  const { snapshot,scope } = fixture();
  snapshot.data.inventory_items[0].expiration_date = "2026-09-11";
  assert.equal(recalculateMaintenanceQuantities(snapshot,scope,"2026-09-12").assessments[0].status,"missing");
  snapshot.data.inventory_items[0].expiration_date = "2026-09-20";
  snapshot.data.inventory_change_logs = [{ id: 1,inventory_item_id: 1,metadata_json: { inventory_version: 1,field_evidence: { quantity: { status: "estimated" } } } }];
  assert.equal(recalculateMaintenanceQuantities(snapshot,scope,"2026-09-12").assessments[0].status,"unknown");
});

test("unknown affected quantities prevent promising their stock to later meals", () => {
  const { snapshot,scope } = fixture(); snapshot.data.meal_plan_items[1].ingredients_json = [{ name: "鸡蛋",amount: "适量" }];
  const result = recalculateMaintenanceQuantities(snapshot,scope,"2026-09-12");
  assert.deepEqual(result.assessments.map(item => item.status),["unknown","unknown"]);
  assert.equal(result.assessments[1].requirements[0].covered,0);
});

test("confirmed and cooking allocations are evaluated once without double reservation", () => {
  const { snapshot,scope } = fixture(); snapshot.data.meal_plan_items.shift();
  snapshot.data.meal_plan_items[0].confirmed_at = "now";
  snapshot.data.meal_plan_items[1].status = "cooking";
  const result = recalculateMaintenanceQuantities(snapshot,scope,"2026-09-12");
  assert.deepEqual(result.assessments.map(item => [item.decision,item.status]),[["suggest","covered"],["keep","covered"]]);
});

test("completed meals release future commitments while changed prepared targets remain explicit", () => {
  const { snapshot,scope } = fixture(); snapshot.data.meal_plan_items[0].status = "completed";
  scope.preparedTargets.push({ planId: "plan",targetId: "leftovers",eventIds: ["eat"] });
  const result = recalculateMaintenanceQuantities(snapshot,scope,"2026-09-12");
  assert.deepEqual(result.assessments.map(item => item.status),["covered","covered"]);
  assert.match(result.checks[0],/期限与复热/);
});


test("skipped daily checks keep information without scanning unrelated incomplete plans", () => {
  const { snapshot,scope } = fixture();
  snapshot.data.meal_plan_items[0].ingredients_json = [];
  scope.items = [];
  scope.checks = [{ eventId: "daily",reason: "每日检查已关闭，跳过该定时事件",level: "info" }];
  const result = recalculateMaintenanceQuantities(snapshot,scope,"2026-09-12");
  assert.deepEqual(result.assessments,[]); assert.deepEqual(result.checks,[]);
  assert.deepEqual(result.notes,["每日检查已关闭，跳过该定时事件"]);
});
