import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defaultInterventionPreferences } from "@dietdigidose/contracts";
import type { NotificationsRepository } from "../src/modules/notifications/repository.js";
import type { CookingQueueRepository } from "../src/modules/cookingQueue/repository.js";
type Query = (sql: string, values: unknown[]) => Promise<Array<Record<string, any>>>;
export async function verifyInterventionQueue(notifications: NotificationsRepository, queue: CookingQueueRepository, query: Query, fault: (enabled: boolean) => Promise<void>) {
  const [user] = await query("INSERT INTO users(username,email,password_hash) VALUES(?,?,?) RETURNING id", [`队列归因-${randomUUID()}`, `${randomUUID()}@example.invalid`, "test-only"]);
  const userId = Number(user.id);
  const [recipe] = await query("INSERT INTO recipes(title,ingredients_json,steps_json,status) VALUES('队列归因菜','[]','[]','approved') RETURNING id", []);
  const recipeId = Number(recipe.id);
  await notifications.saveInterventionPreferences(userId,{ ...defaultInterventionPreferences,enabled: true,dinner_window: true,quiet_start: "00:00",quiet_end: "00:00",version: 0 });
  await notifications.saveDevice(userId,`ExpoPushToken[queue-${userId}]`,"android");
  const now = Date.now();
  const intervention = await notifications.reserveIntervention({ now, featureEnabled: true, pushAuthorized: true, dinnerAlreadyPlanned: false, cookingInProgress: false, notCookingToday: false,
    candidate: { userId, sourceKey: `queue:${randomUUID()}`,kind: "dinner_window",startsAt: now-1000,expiresAt: now+3600000,dataObservedAt: now,localDate: new Date(now).toISOString().slice(0,10),
      inventoryIds: [1],recipeIds: [recipeId],recommendationQuality: 0.9,title: "安排菜谱",body: "测试",whyNow: "用餐窗口",expiresLabel: "一小时",actions: ["plan_recipe"] } });
  assert(intervention.notification_id);
  const input = { id: randomUUID(), userId, recipeId, snapshot: {}, interventionId: String(intervention.id), confirmed: true as const, idempotencyKey: randomUUID() };
  await assert.rejects(() => queue.enqueue({ ...input, confirmed: undefined },30), /确认/);
  await assert.rejects(() => queue.enqueue({ ...input, userId: userId+999 },30), /提醒不存在/);
  await assert.rejects(() => queue.enqueue({ ...input, recipeId: recipeId+999 },30), /菜谱不在/);
  const results = await Promise.all([queue.enqueue(input,30), queue.enqueue({ ...input,id: randomUUID() },30)]);
  assert.deepEqual(results.map(value => value.kind).sort(),["created","existing"]);
  const result = results.find(value => value.kind === "created")!;
  assert(result.kind === "created");
  const id = String(result.row.id);
  const version = Number(result.row.version);
  assert.equal((await query("SELECT COUNT(*) n FROM proactive_intervention_outcomes WHERE user_id=?",[userId]))[0].n,0,"enqueue is not cooking started");
  await assert.rejects(() => queue.enqueue({ ...input,mealType: "晚餐" },30), /重试内容/);
  await fault(true);
  try { await assert.rejects(() => queue.transition(id,userId,version,"cooking"), /attribution failure/); }
  finally { await fault(false); }
  assert.equal((await queue.findOwned(id,userId))?.status,"waiting");
  const started = await queue.transition(id,userId,version,"cooking");
  assert.equal(started?.status,"cooking");
  assert.equal(await queue.transition(id,userId,version,"cooking"),null);
  assert.equal((await query("SELECT COUNT(*) n FROM proactive_intervention_outcomes WHERE user_id=? AND outcome_type='cooking_started'",[userId]))[0].n,1);
  const replay = await queue.enqueue(input,30);
  assert(replay.kind === "existing");
  assert.equal(replay.row.id,id);
  const metrics = (await notifications.adminData(new Date(now-1000).toISOString())).interventionMetrics!;
  assert(metrics.cooking_started >= 1); assert(metrics.action_plan_recipe >= 1);
}
