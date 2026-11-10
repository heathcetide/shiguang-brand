import { weeklyShoppingWindow, weeklyHistoryStart } from "../src/modules/recommendations/shoppingWindow.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWeeklyPlan } from "../src/modules/recommendations/weeklyPlan.js";
import { cookingPlanDraftSchema, type PreparedMeal } from "@dietdigidose/contracts";
const startDate = "2099-09-12";
const candidate = { recipeId: 1,score: 100,recipe: { title: "蛋羹",ingredients: [{ name: "鸡蛋",amount: "1个" }],serving_size: 1,cook_time: 10,prep_time: 2 } } as Parameters<typeof buildWeeklyPlan>[2][number];
const stock = (id: number, count: number, expiry = "2099-09-30") => ({ id,food_name: "鸡蛋",quantity_value: count,quantity_unit: "piece",expiration_date: expiry,version: 1,batch_code: null });
const input = { startDate,mealTypes: ["lunch" as const],servings: 1 };

test("weekly reservations merge ten eggs across seven meals into six to buy, with meal provenance", () => {
  const existing = [12,13,14].map(day => ({ id: `existing:${day}`,planned_date: `2099-09-${day}`,meal_type: "午餐",title: "双蛋羹",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "2个" }] }));
  const inventory = [stock(16,4)];
  const plan = buildWeeklyPlan(input,{ meal_time_minutes: 30 },[candidate],inventory,[],existing,[{ id: "shopping",name: "鸡蛋",amount: "10个",checked: false }]);
  assert.equal(plan.slots.length,7);
  assert.equal(plan.slots.filter(slot => slot.state === "preserved").length,3);
  assert.deepEqual(plan.shopping.map(item => [item.required,item.covered,item.missing]),[[10,4,6]]);
  assert.equal(plan.shopping[0].sources.length,7);
  assert.equal(plan.plannedPurchases.length,1);
  assert.equal(inventory[0].quantity_value,4);
  assert.equal(plan.draft?.cooking.length,4);
});

test("future allocation uses expiry on the target date and never reuses the same stock", () => {
  const plan = buildWeeklyPlan(input,{ meal_time_minutes: 30 },[candidate],[stock(1,10,startDate)],[],[],[]);
  assert.equal(plan.shopping[0].covered,1);
  assert.equal(plan.shopping[0].missing,6);
  assert.equal(plan.shopping[0].sources[0].missing,0);
  assert.equal(plan.shopping[0].sources[1].missing,1);
});

test("reserved prepared meals cannot be reused; rolling keeps relevant existing meals", () => {
  const batch = { id: "19600000-0000-4000-8000-000000000001",food_name: "现成蛋羹",remaining_servings: 2,produced_at: "2099-09-12T08:00:00Z",version: 1,is_reserved: false,planned_date: null,meal_type: "午餐" } as PreparedMeal;
  const plan = buildWeeklyPlan(input,{ meal_time_minutes: 30 },[candidate],[],[batch],[],[],[{ preparedMealId: batch.id,servings: 1 }]);
  assert.equal(plan.draft?.meals.reduce((sum,meal) => sum+meal.preparedServings,0),1);
  assert.equal(batch.remaining_servings,2);
  const rolled = buildWeeklyPlan({ ...input,startDate: "2099-09-13" },{},[candidate],[],[],[{ id: "kept",planned_date: "2099-09-14",meal_type: "午餐",title: "保留饭",status: "completed" }],[]);
  assert.equal(rolled.endDate,"2099-09-19");
  assert.equal(rolled.slots.find(slot => slot.date === "2099-09-14")?.state,"preserved");
});

test("unknown committed quantities and excessive cooking time remain unresolved", () => {
  const plan = buildWeeklyPlan(input,{},[candidate],[stock(1,100)],[],[{ id: "unknown",planned_date: startDate,meal_type: "午餐",title: "现有安排",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "适量" }] }],[]);
  assert.equal(plan.draft?.unresolved.length,6);
  assert.equal(plan.shopping.length,0);
  const tooLong = buildWeeklyPlan(input,{ meal_time_minutes: 5 },[candidate],[],[],[],[]);
  assert.equal(tooLong.draft?.unresolved.length,7);
});

test("weekly replacement reserves other plans and applies target-day expiry without changing other meals", async () => {
  const { replaceCookingDraft } = await import("../src/modules/recommendations/plan.js");
  const inventory = [stock(1,4,"2099-09-13")];
  const existing = [{ id: "existing",planned_date: startDate,meal_type: "午餐",title: "原有双蛋",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "2个" }] }];
  const original = buildWeeklyPlan(input,{},[candidate],inventory,[],existing,[]).draft!;
  const replacement = { ...candidate,recipeId: 2,recipe: { ...candidate.recipe,title: "双蛋",ingredients: [{ name: "鸡蛋",amount: "2个" }] } };
  const changed = replaceCookingDraft(original,"week:2099-09-13:lunch",2,[candidate,replacement],inventory,existing);
  const eggs = changed.draft.weeklyShopping![0];
  assert.deepEqual([eggs.required,eggs.covered,eggs.missing],[9,4,5]);
  assert.equal(changed.draft.ingredientBudget[0].covered_value,2);
  assert(changed.draft.ingredientBudget.slice(1).every(item => item.covered_value === 0));
  assert.deepEqual(changed.draft.cooking.slice(1),original.cooking.slice(1));
  assert.equal(inventory[0].quantity_value,4);
});

test("rechecking after cancellation and purchase updates shortages while retaining manual shopping", () => {
  const existing = [{ id: "existing",planned_date: startDate,meal_type: "午餐",title: "原有双蛋",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "2个" }] }];
  const shopping = [{ id: "manual",name: "手工采购",amount: "一盒",checked: false }];
  const before = buildWeeklyPlan(input,{},[candidate],[stock(1,4)],[],existing,shopping);
  const after = buildWeeklyPlan(input,{},[candidate],[stock(1,8)],[],[{ ...existing[0],status: "skipped" }],shopping);
  assert.equal(before.shopping[0].missing,4);
  assert.equal(after.shopping[0].required,7);
  assert.equal(after.shopping[0].missing,0);
  assert.deepEqual(after.plannedPurchases,before.plannedPurchases);
});

test("no-spicy weekly planning does not assume a prepared batch has verified spice content",() => {
  const batch = { id: "19600000-0000-4000-8000-000000000001",food_name: "昨天的饭",remaining_servings: 2,produced_at: "2099-09-12T08:00:00Z",version: 1,is_reserved: false,planned_date: null,meal_type: "午餐" } as PreparedMeal;
  const preview = buildWeeklyPlan(input,{ avoid_spicy: true },[candidate],[],[batch],[],[]);
  assert(preview.draft!.meals.every(meal => meal.preparedServings === 0));
  assert(preview.checksPending.some(message => message.includes("辣度未核实")));
});


test("future commitments reserve stock without adding outside-week shopping demand", () => {
  const future = { id: "future",planned_date: "2099-09-20",meal_type: "午餐",title: "已确认后续餐",status: "planned",confirmed_at: "now",ingredients_json: [{ name: "鸡蛋",amount: "2个" }] };
  const result = buildWeeklyPlan(input,{},[candidate],[stock(1,4)],[],[future],[]);
  assert.deepEqual(result.shopping.map(item => [item.required,item.covered,item.missing]),[[7,2,5]]);
  assert.ok(result.shopping[0].sources.every(source => source.mealId !== "future"));
  assert.deepEqual(result.draft?.shoppingWindow,{ startDate: "2099-09-12",endDate: "2099-09-18" });
});


test("weekly shopping window cannot exclude its cooking dates", () => {
  const draft = buildWeeklyPlan(input,{},[candidate],[stock(1,7)],[],[],[]).draft!;
  assert.equal(cookingPlanDraftSchema.safeParse({ ...draft,shoppingWindow: { startDate: "2099-09-13",endDate: "2099-09-19" } }).success,false);
});


test("legacy weekly windows recover preserved dates rather than shrinking to cooking dates", async () => {
  const existing = [{ id: "kept",planned_date: startDate,meal_type: "午餐",title: "已有安排",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "1个" }] }];
  const generated = buildWeeklyPlan(input,{},[candidate],[stock(1,7)],[],existing,[]).draft!;
  const legacy = { ...generated,shoppingWindow: undefined };
  assert.equal(legacy.meals[0].date,"2099-09-13");
  assert.equal(weeklyHistoryStart(legacy),"2099-09-07");
  assert.deepEqual(weeklyShoppingWindow(legacy,existing),{ startDate,endDate: "2099-09-18" });
  assert.throws(() => weeklyShoppingWindow(legacy,[]),/重新生成七日预览/);
  const { replaceCookingDraft } = await import("../src/modules/recommendations/plan.js");
  const replacement = { ...candidate,recipeId: 2,recipe: { ...candidate.recipe,ingredients: [{ name: "鸡蛋",amount: "2个" }] } };
  const prior = { ...existing[0],id: "prior-week",planned_date: "2099-09-10",ingredients_json: [{ name: "鸡蛋",amount: "100个" }] };
  const updated = replaceCookingDraft(legacy,legacy.cooking[0].targetMealId,2,[candidate,replacement],[stock(1,7)],[prior,...existing]);
  assert.deepEqual(updated.draft.shoppingWindow,{ startDate,endDate: "2099-09-18" });
  assert.deepEqual(updated.shopping?.map(item => [item.required,item.covered,item.missing]),[[8,7,1]]);
});

test("prepared meals respect handling hold limits and are not allocated beyond safe dates", () => {
  const batch = {
    id: "19600000-0000-4000-8000-000000000002",
    recipe_id: 1,
    food_name: "短保冷藏蛋羹",
    remaining_servings: 2,
    produced_at: "2099-09-12T08:00:00Z",
    version: 1,
    is_reserved: false,
    planned_date: null,
    storage_location: "refrigerator",
  } as PreparedMeal;

  const rules = new Map([[1, {
    storage: "refrigerated" as const,
    maxHoldHours: 24,
    coldServingAllowed: true,
    carryAllowed: true,
    instructions: "冷藏保存24小时内食用",
    reference: "测试标准",
    sourceUrl: "https://example.com/test",
  }]]);

  // When day 1 is preserved, day 2 (targetDate 2099-09-13, 24-48h) cannot safely use this 24h batch
  const existing = [{
    id: "existing:day1",
    planned_date: startDate,
    meal_type: "午餐",
    title: "第一天自带饭",
    status: "planned",
    ingredients_json: [],
  }];

  const plan = buildWeeklyPlan(
    input,
    { meal_time_minutes: 30, refrigeration_available: true },
    [candidate],
    [stock(1, 10)],
    [batch],
    existing,
    [],
    [],
    [],
    rules,
  );

  // Day 1 was preserved
  assert.equal(plan.slots[0].state, "preserved");
  // Day 2 target date 2099-09-13 exceeds 24h maxHoldHours, so it must cook instead of reusing unsafe batch
  const day2Slot = plan.slots[1];
  assert.equal(day2Slot.date, "2099-09-13");
  assert.equal(plan.draft?.meals[0].preparedServings, 0);
  assert.equal(plan.draft?.meals[0].cookServings, 1);
  assert(plan.draft?.handlingChecks?.some(check => check.status === "conflict" && check.reasons.some(r => r.includes("24 小时冷藏期限"))));
});

test("items beyond position 15 in inventory participate in planning and missing expiry triggers uncertainty", () => {
  // Create 20 inventory items, with eggs placed at position 18 (index 17)
  const inventory = Array.from({ length: 20 }, (_, index) => {
    if (index === 17) {
      return stock(18, 10, "2099-09-30");
    }
    return {
      id: index + 1,
      food_name: `原料${index + 1}`,
      quantity_value: 5,
      quantity_unit: "g",
      // Item 2 has unknown expiration date
      expiration_date: index === 1 ? null : "2099-10-31",
      version: 1,
      batch_code: null,
    };
  });

  const plan = buildWeeklyPlan(input, { meal_time_minutes: 30 }, [candidate], inventory, [], [], []);

  // Eggs at item 18 successfully covered 7 days of lunch
  assert.equal(plan.shopping.length, 1);
  assert.equal(plan.shopping[0].foodName, "鸡蛋");
  assert.equal(plan.shopping[0].required, 7);
  assert.equal(plan.shopping[0].covered, 7);
  assert.equal(plan.shopping[0].missing, 0);

  // Missing expiration date on item 2 produces uncertainty warning in checksPending
  assert(plan.checksPending.some(check => check.includes("部分库存缺少可用期限，未来餐次使用前需核对")));
});

test("inconvertible units mark shopping as uncertain and do not invent quantities", () => {
  // Recipe demands 1 "个" (piece), but stock has unit "ml" which cannot convert
  const inconvertibleStock = [{
    id: 1,
    food_name: "鸡蛋",
    quantity_value: 500,
    quantity_unit: "ml",
    expiration_date: "2099-09-30",
    version: 1,
    batch_code: null,
  }];

  const plan = buildWeeklyPlan(input, { meal_time_minutes: 30 }, [candidate], inconvertibleStock, [], [], []);

  // Unknown unit status marks the aggregate shopping entry as uncertain
  assert.equal(plan.shopping[0].uncertain, true);
  assert(plan.checksPending.some(check => check.includes("鸡蛋 的数量或规格无法换算，请核对采购缺口")));
});
