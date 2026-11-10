import assert from "node:assert/strict";
import type { WeeklyPlanPreview } from "@dietdigidose/contracts";
import type { Row } from "../src/modules/mealPlans/formatters.js";

export async function verifyWeeklyRoll(userId: number,query: (sql: string,args?: unknown[]) => Promise<Row[]>,preview: () => Promise<WeeklyPlanPreview>) {
  const food = "滚动验收专用食材ABC";
  const ingredients = JSON.stringify([{ name: food,amount: "1个" }]);
  const recipeId = Number((await query("INSERT INTO recipes(title,ingredients_json,steps_json,status,serving_size,prep_time,cook_time) VALUES('滚动验收餐',?,'[]','approved',1,1,5) RETURNING id",[ingredients]))[0].id);
  const stockId = Number((await query("INSERT INTO inventory_items(user_id,food_name,category,quantity,quantity_value,quantity_unit,expiration_date) VALUES(?,?,'其他','7个',7,'piece','2036-09-30') RETURNING id",[userId,food]))[0].id);
  await query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date) VALUES('roll-plan',?,'滚动验收','2036-09-12','2036-09-18')",[userId]);
  for (let day = 12; day<=18; day++) await query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,status,confirmed_at) VALUES(?,'roll-plan',?,?,'午餐','已有安排',?,?,?,?)",[
    `roll-${day}`,userId,`2036-09-${day}`,recipeId,ingredients,day === 15 ? "queued" : day === 16 ? "cooking" : "planned","2036-09-11T00:00:00Z",
  ]);
  await query("INSERT INTO shopping_list_items(id,user_id,client_id,name,checked) VALUES('roll-purchase',?,'meal-plan:roll-14:0','已采购原料',TRUE)",[userId]);
  const before = await query("SELECT * FROM meal_plan_items WHERE plan_id='roll-plan' ORDER BY id");
  const first = await preview();
  assert.equal(first.startDate,"2036-09-13"); assert.equal(first.endDate,"2036-09-19");
  assert.equal(first.slots.length,7);
  assert.deepEqual(first.slots.filter(slot => slot.state === "preserved").flatMap(slot => slot.preservedItemIds).sort(),[13,14,15,16,17,18].map(day => `roll-${day}`));
  assert.equal(first.slots[6].state,"proposed");
  assert.equal(first.draft?.cooking.length,1); assert.equal(first.draft?.cooking[0].recipeId,recipeId);
  const budget = first.shopping.find(item => item.foodName === food)!;
  assert.deepEqual([budget.required,budget.covered,budget.missing],[7,7,0]);
  assert.ok(budget.sources.every(source => source.mealId !== "roll-12"));
  const repeated = await preview();
  assert.deepEqual(repeated.slots,first.slots); assert.deepEqual(repeated.shopping,first.shopping);
  assert.deepEqual(await query("SELECT * FROM meal_plan_items WHERE plan_id='roll-plan' ORDER BY id"),before);
  assert.equal(Number((await query("SELECT quantity_value FROM inventory_items WHERE id=?",[stockId]))[0].quantity_value),7);
  await query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date) VALUES('roll-future',?,'下一周承诺','2036-09-20','2036-09-20')",[userId]);
  await query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,confirmed_at) VALUES('roll-future-item','roll-future',?,'2036-09-20','午餐','后续已确认',?,?,'2036-09-11T00:00:00Z')",[userId,recipeId,ingredients]);
  const protectedPreview = await preview();
  const protectedBudget = protectedPreview.shopping.find(item => item.foodName === food)!;
  assert.equal(protectedBudget.covered,6);
  assert.ok(protectedPreview.shopping.some(item => item.sources.some(source => source.mealId === "week:2036-09-19:lunch" && source.missing>0)));
  assert.ok(protectedPreview.draft?.ingredientBudget.every(item => (item.deductions ?? []).every(deduction => deduction.item_id !== stockId)));
  assert.ok(protectedBudget.sources.every(source => source.mealId !== "roll-future-item"));
  assert.deepEqual(await query("SELECT * FROM meal_plan_items WHERE plan_id='roll-plan' ORDER BY id"),before);

}
