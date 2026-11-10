import assert from "node:assert/strict";
import { test } from "node:test";
import { maintenanceScope } from "../src/modules/planMaintenance/scope.js";
import type { Row } from "../src/modules/mealPlans/formatters.js";

function fixture() {
  return { userId: 1,fromDate: "2026-09-12",inventory: [{ id: 10,user_id: 1,food_name: "新鲜 鸡蛋" }],prepared: [] as Row[],
    events: [{ id: "event",user_id: 1,event_type: "inventory_created",subject_id: "10" }] as Row[],
    plans: [{ id: "plan",user_id: 1,status: "active",version: 2 }] as Row[],
    items: [
      { id: "egg",user_id: 1,plan_id: "plan",planned_date: "2026-09-12",version: 3,status: "planned",ingredients_json: JSON.stringify([{ name: "鸡蛋",amount: "1个" }]) },
      { id: "rice",user_id: 1,plan_id: "plan",planned_date: "2026-09-13",version: 1,status: "planned",ingredients_json: [{ name: "大米",amount: "100g" }] },
    ] as Row[] };
}

test("inventory and production affect only meals using the same stock names as allocation", () => {
  const input = fixture();
  assert.deepEqual(maintenanceScope(input).items,[{ planId: "plan",itemId: "egg",version: 3,planVersion: 2,eventIds: ["event"] }]);
  input.events = [{ id: "cooked",user_id: 1,event_type: "cooking_completion",subject_id: "record",details_json: { inventoryItemIds: [10] } }];
  assert.deepEqual(maintenanceScope(input).items[0].eventIds,["cooked"]);
});

test("account boundaries, cancelled plans and completed or past meals are excluded", () => {
  const input = fixture();
  input.items.push({ ...input.items[0],id: "foreign",user_id: 2 });
  for (const [id,extra] of [["past",{ planned_date: "2026-09-11" }],["finished",{ status: "completed" }],["skipped",{ status: "skipped" }],["deleted",{ deleted_at: "now" }]] as const) {
    input.items.push({ ...input.items[0],id,...extra });
  }
  input.events.push({ ...input.events[0],id: "foreign-event",user_id: 2 });
  assert.deepEqual(maintenanceScope(input).items.map(item => item.itemId),["egg"]);
  input.plans[0].status = "cancelled";
  assert.deepEqual(maintenanceScope(input).items,[]);
});

test("confirmed meals remain in dependency scope so the change policy can propose instead of silently skip", () => {
  const input = fixture(); input.items[0].confirmed_at = "2026-09-11";
  assert.equal(maintenanceScope(input).items.length,1);
});

test("prepared consumption reaches only linked future targets and their execution items", () => {
  const input = fixture();
  input.prepared = [{ id: "batch",user_id: 1,remaining_servings: 1 }];
  input.events = [{ id: "eat",user_id: 1,event_type: "eat",subject_id: "batch" }];
  input.plans[0].constraints_json = { currentCookingDraft: { meals: [
    { id: "target",date: "2026-09-13",allocations: [{ preparedMealId: "batch" }] },
    { id: "past",date: "2026-09-11",allocations: [{ preparedMealId: "batch" }] },
    { id: "other",date: "2026-09-13",allocations: [{ preparedMealId: "another" }] },
  ] },executionItems: { egg: { targetMealId: "target" } } };
  const scope = maintenanceScope(input);
  assert.deepEqual(scope.preparedTargets,[{ planId: "plan",targetId: "target",eventIds: ["eat"] }]);
  assert.deepEqual(scope.items.map(item => item.itemId),["egg"]);
  assert.deepEqual(scope.checks,[]);
});

test("missing facts and new unallocated batches require checks instead of widening to the whole week", () => {
  const input = fixture(); input.events[0].subject_id = "999";
  let scope = maintenanceScope(input);
  assert.equal(scope.items.length,0); assert.equal(scope.checks.length,1);
  input.events = [{ id: "new",user_id: 1,event_type: "production",subject_id: "batch" }];
  input.prepared = [{ id: "batch",user_id: 1,remaining_servings: 1 }];
  scope = maintenanceScope(input);
  assert.equal(scope.items.length,0); assert.match(scope.checks[0].reason,/尚无未来餐次分配/);
});

test("duplicate events coalesce and malformed ingredients remain an explicit check", () => {
  const input = fixture(); input.events.push({ ...input.events[0] }); input.items[1].ingredients_json = "invalid";
  const scope = maintenanceScope(input);
  assert.deepEqual(scope.items[0].eventIds,["event"]); assert.equal(scope.checks.length,1);
  input.events = [{ id: "unknown",user_id: 1,event_type: "future-kind",subject_id: "x" }];
  assert.match(maintenanceScope(input).checks[0].reason,/未知/);
});


test("daily checks inspect all future active meals only while enabled", () => {
  const input = fixture();
  input.events = [{ id: "daily",user_id: 1,event_type: "daily_check",subject_id: "2026-09-12" }];
  input.items.push({ ...input.items[0],id: "past",planned_date: "2026-09-11" });
  input.items.push({ ...input.items[0],id: "done",status: "completed" });
  input.items.push({ ...input.items[0],id: "other",user_id: 2 });
  assert.deepEqual(maintenanceScope({ ...input,dailyEnabled: true }).items.map(item => item.itemId),["egg","rice"]);
  assert.deepEqual(maintenanceScope({ ...input,dailyEnabled: false }).items,[]);
  assert.ok(maintenanceScope({ ...input,dailyEnabled: false }).checks[0].reason.includes("关闭"));
});


test("renaming stock checks both old and current ingredient dependencies, including deleted stock", () => {
  const input = fixture();
  input.inventory[0].food_name = "大米";
  input.events = [{ id: "renamed",user_id: 1,event_type: "inventory_changed",subject_id: "10",details_json: { previousFoodName: "鸡蛋" } }];
  assert.deepEqual(maintenanceScope(input).items.map(item => item.itemId),["egg","rice"]);
  Object.assign(input.inventory[0],{ deleted_at: "now",is_available: false });
  assert.deepEqual(maintenanceScope(input).items.map(item => item.itemId),["egg","rice"]);
});
