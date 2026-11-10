import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DietRecordsService } from "../../src/modules/dietRecords/service.js";

type Query = (sql: string, values?: (string | number)[]) => Promise<Record<string, unknown>[]>;
export async function verifyCancelledProduction(diet: DietRecordsService, userId: number, query: Query) {
  const recipeId = Number((await query("INSERT INTO recipes(title) VALUES(?) RETURNING id", ["取消制作保护"]))[0].id);
  const stockId = Number((await query(`INSERT INTO inventory_items(user_id,food_name,category,quantity,quantity_value,quantity_unit,expiration_date)
    VALUES(?,'取消制作原料','其他','2个',2,'piece','2099-12-31') RETURNING id`, [userId]))[0].id);
  const snapshot = async () => ({
    stock: await query("SELECT quantity_value,version,is_available FROM inventory_items WHERE id=?", [stockId]),
    meals: await query("SELECT id,remaining_servings FROM prepared_meals WHERE user_id=? ORDER BY id", [userId]),
    intake: await query("SELECT id FROM diet_records WHERE user_id=? ORDER BY id", [userId]),
  });
  for (const status of ["draft", "cancelled", "completed", "active"]) {
    const planId = randomUUID(), itemId = randomUUID(), queueId = randomUUID();
    await query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date,status) VALUES(?,?,'停止制作','2099-09-13','2099-09-13',?)", [planId,userId,status]);
    await query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title) VALUES(?,?,?,'2099-09-13','晚餐','停止制作')", [itemId,planId,userId]);
    const input = { idempotency_key: randomUUID(), inventory_item_ids: [], inventory_consumptions: [{ item_id: stockId,version: 1,mode: "all" as const }],
      production: { food_name: "停止制作", produced_servings: 1,eaten_servings: 0,meal_type: "晚餐",nutrition_per_serving: {},plan_item_id: itemId,plan_version: 1 } };
    if (status === "active") {
      const result = await diet.completeCooking(userId,input);
      assert.equal(result.repeated,false);
      await query("UPDATE meal_plans SET status='cancelled' WHERE id=?", [planId]);
      const before = await snapshot();
      assert.equal((await diet.completeCooking(userId,input)).repeated,true,"committed production remains replayable after cancellation");
      assert.deepEqual(await snapshot(),before);
    } else {
      const before = await snapshot();
      await assert.rejects(diet.completeCooking(userId,input), { code: "MEAL_SOURCE_CONFLICT" });
      // An old cooking screen only knows the queue identity; resolve its parent before writing.
      await query("INSERT INTO cooking_queue_items(id,user_id,recipe_id,position) VALUES(?,?,?,0)", [queueId,userId,recipeId]);
      await query("UPDATE meal_plan_items SET queue_item_id=? WHERE id=?", [queueId,itemId]);
      await assert.rejects(diet.completeCooking(userId,{ ...input,idempotency_key: randomUUID(),production: { ...input.production,
        plan_item_id: undefined,plan_version: undefined,queue_item_id: queueId,queue_version: 1 } }), { code: "MEAL_SOURCE_CONFLICT" });
      assert.deepEqual(await snapshot(),before,"rejection must preserve stock, prepared meals and intake");
      assert.equal((await query("SELECT status FROM meal_plan_items WHERE id=?",[itemId]))[0].status,"planned");
      assert.equal((await query("SELECT status FROM cooking_queue_items WHERE id=?",[queueId]))[0].status,"waiting");
      await query("UPDATE cooking_queue_items SET status='cancelled' WHERE id=?",[queueId]);
    }
  }
}
