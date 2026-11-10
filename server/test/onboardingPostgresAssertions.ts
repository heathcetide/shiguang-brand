import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { actorHashFor } from "../src/services/funnelEvents.js";
import { OnboardingService } from "../src/modules/onboarding/service.js";
import { PostgresOnboardingRepository } from "../src/modules/onboarding/postgresRepository.js";

/** Run against the freshly migrated PostgreSQL database, alongside the other adapter assertions. */
export async function verifyOnboardingPostgres(pool: Pool) {
  const userIds: number[] = [];
  const service = new OnboardingService(new PostgresOnboardingRepository(pool));
  const suffix = randomUUID().slice(0, 8);
  try {
    for (const label of ["inventory", "diet", "meal", "nutrition", "other"]) {
      const row = (await pool.query("INSERT INTO users(username,email,password_hash) VALUES($1,$2,'fixture') RETURNING id", [`first-${label}-${suffix}`, `first-${label}-${suffix}@example.com`])).rows[0];
      userIds.push(Number(row.id));
    }
    const [inventoryUser, dietUser, mealUser, nutritionUser, otherUser] = userIds;
    assert.equal((await service.get(inventoryUser)).status, "not_started");
    const addInventory = async (userId: number, name: string) => Number((await pool.query("INSERT INTO inventory_items(user_id,food_name,category,quantity,expiration_date) VALUES($1,$2,'蔬菜','数量未知','') RETURNING id", [userId, name])).rows[0].id);
    await addInventory(inventoryUser, "任务开始前已存在");
    const request = { version: 0, requestKey: randomUUID(), selectedTask: "inventory" as const, step: "task" as const };
    const starts = await Promise.all([service.update(inventoryUser, request), service.update(inventoryUser, request)]);
    assert.deepEqual(starts[0], starts[1]);
    assert.equal((await service.get(inventoryUser)).status, "in_progress");
    const otherItem = await addInventory(otherUser, "其他账号库存");
    await assert.rejects(service.update(inventoryUser, { version: 1, status: "completed", completion: { task: "inventory", resourceId: String(otherItem) } }), { code: "ONBOARDING_TASK_NOT_COMPLETED" });
    const races = await Promise.allSettled([service.update(inventoryUser, { version: 1, status: "paused" }), service.update(inventoryUser, { version: 1, dismissed: true })]);
    assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
    const current = await service.get(inventoryUser);
    await service.update(inventoryUser, { version: current.version, status: "in_progress", dismissed: false });
    const ownItem = await addInventory(inventoryUser, "本次真实保存");
    const completions = await Promise.all([service.get(inventoryUser), service.get(inventoryUser)]);
    assert.deepEqual(completions[0], completions[1]);
    assert.deepEqual(completions[0].completion, { task: "inventory", resourceId: String(ownItem) });
    assert.equal((await pool.query("SELECT COUNT(*)::integer AS n FROM funnel_events WHERE actor_hash=$1 AND event_name='onboarding_completed'", [actorHashFor(inventoryUser)])).rows[0].n, 1);

    await service.update(dietUser, { version: 0, selectedTask: "diet_record" });
    const failureKey = randomUUID();
    await Promise.all([service.saveFailed(dietUser, failureKey), service.saveFailed(dietUser, failureKey)]);
    assert.equal((await pool.query("SELECT COUNT(*)::integer AS n FROM funnel_events WHERE actor_hash=$1 AND event_name='onboarding_save_failed'", [actorHashFor(dietUser)])).rows[0].n, 1);
    const dietId = String((await pool.query("INSERT INTO diet_records(user_id,meal_type,food_name,amount,recorded_at) VALUES($1,'午餐','一餐','数量未知','2026-09-20') RETURNING id", [dietUser])).rows[0].id);
    assert.deepEqual((await service.get(dietUser)).completion, { task: "diet_record", resourceId: dietId });

    await service.update(mealUser, { version: 0, selectedTask: "meal_plan" });
    const planId = randomUUID();
    await pool.query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date,status) VALUES($1,$2,'本次一餐','2026-09-20','2026-09-20','active')", [planId, mealUser]);
    assert.equal((await service.get(mealUser)).status, "in_progress");
    await pool.query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title) VALUES($1,$2,$3,'2026-09-20','dinner','番茄炒蛋')", [randomUUID(), planId, mealUser]);
    assert.deepEqual((await service.get(mealUser)).completion, { task: "meal_plan", resourceId: planId });

    await pool.query("INSERT INTO user_health_profiles(user_id,profile_version,nutrition_target_source,nutrition_targets_json,nutrition_target_version) VALUES($1,4,'user',$2::jsonb,4)", [nutritionUser, JSON.stringify({ calories_kcal: 2100 })]);
    await service.update(nutritionUser, { version: 0, selectedTask: "nutrition" });
    await pool.query("UPDATE user_health_profiles SET profile_version=5 WHERE user_id=$1", [nutritionUser]);
    assert.equal((await service.get(nutritionUser)).status, "in_progress");
    await pool.query("UPDATE user_health_profiles SET profile_version=6,nutrition_target_version=6,nutrition_target_source='legacy_unconfirmed' WHERE user_id=$1", [nutritionUser]);
    assert.equal((await service.get(nutritionUser)).status, "in_progress");
    await pool.query("UPDATE user_health_profiles SET profile_version=7,nutrition_target_version=7,nutrition_target_source='user' WHERE user_id=$1", [nutritionUser]);
    assert.equal((await service.get(nutritionUser)).status, "completed");
    assert.equal((await service.get(otherUser)).selectedTask, null);
  } finally {
    await pool.query("DELETE FROM users WHERE id=ANY($1::integer[])", [userIds]);
  }
  assert.equal((await pool.query("SELECT COUNT(*)::integer AS n FROM user_onboarding WHERE user_id=ANY($1::integer[])", [userIds])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT COUNT(*)::integer AS n FROM onboarding_event_receipts WHERE user_id=ANY($1::integer[])", [userIds])).rows[0].n, 0);
}
