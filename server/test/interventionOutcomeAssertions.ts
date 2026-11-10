import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defaultInterventionPreferences } from "@dietdigidose/contracts";
import type { NotificationsRepository } from "../src/modules/notifications/repository.js";
import type { InsightsRepository } from "../src/modules/insights/repository.js";
type Query = (sql: string, values: unknown[]) => Promise<Array<Record<string, any>>>;
export async function verifyInterventionOutcomes(notifications: NotificationsRepository, insights: InsightsRepository, userId: number, query: Query, fault: (enabled: boolean) => Promise<void>) {
  const preferences = await notifications.interventionPreferences(userId);
  await notifications.saveInterventionPreferences(userId, { ...defaultInterventionPreferences, enabled: true, expiry_rescue: true,
    quiet_start: "00:00", quiet_end: "00:00", version: Number(preferences?.version || 0) });
  await notifications.saveDevice(userId, `ExpoPushToken[outcome-${userId}]`, "android");
  const [item] = await query("INSERT INTO inventory_items(user_id,food_name,category,quantity,quantity_value,quantity_unit,expiration_date) VALUES(?,'归因番茄','蔬菜','500g',500,'g','2099-01-01') RETURNING id,version", [userId]);
  const now = Date.now();
  const row = await notifications.reserveIntervention({ now, featureEnabled: true, pushAuthorized: true, dinnerAlreadyPlanned: false, cookingInProgress: false, notCookingToday: false,
    candidate: { userId, sourceKey: `outcome:${randomUUID()}`, kind: "expiry_rescue", startsAt: now - 1000, expiresAt: now + 3600000, dataObservedAt: now,
      localDate: new Date(now).toISOString().slice(0,10), inventoryIds: [Number(item.id)], recipeIds: [1], recommendationQuality: 0.9,
      title: "归因测试", body: "逐项确认", whyNow: "临期", expiresLabel: "一小时", actions: ["mark_consumed","mark_discarded"] } });
  assert(row.notification_id);
  const input = { scope: "personal" as const, itemId: Number(item.id), itemVersion: Number(item.version), outcome: "used" as const, source: "reminder",
    closeItem: true, confirmed: true as const, interventionId: String(row.id), idempotencyKey: randomUUID() };
  await assert.rejects(() => insights.createOutcome(userId, { ...input, confirmed: undefined }), /明确确认/);
  await assert.rejects(() => insights.createOutcome(userId + 999, input), /提醒不存在/);
  await assert.rejects(() => insights.createOutcome(userId, { ...input, itemId: Number(item.id) + 999 }), /库存不在/);
  await fault(true);
  try { await assert.rejects(() => insights.createOutcome(userId,input), /attribution failure/); }
  finally { await fault(false); }
  assert.equal((await query("SELECT COUNT(*) n FROM inventory_items WHERE id=? AND deleted_at IS NOT NULL", [item.id]))[0].n, 0);
  assert.equal((await query("SELECT COUNT(*) n FROM inventory_outcome_events WHERE user_id=? AND idempotency_key=?", [userId,input.idempotencyKey]))[0].n, 0);
  const results = await Promise.all([insights.createOutcome(userId,input), insights.createOutcome(userId,input)]);
  assert.deepEqual(results.map(value => value.kind).sort(), ["created", "repeated"]);
  const first = results.find(value => value.kind === "created")!;
  assert(first.kind === "created");
  assert.equal((await query("SELECT COUNT(*) n FROM proactive_intervention_outcomes WHERE user_id=? AND intervention_id=?", [userId,row.id]))[0].n, 1);
  assert.equal((await query("SELECT COUNT(*) n FROM inventory_items WHERE id=? AND deleted_at IS NOT NULL", [item.id]))[0].n, 1);
  await assert.rejects(() => insights.createOutcome(userId, { ...input, outcome: "discarded" }), /重试内容/);
  await assert.rejects(() => insights.createOutcome(userId, { ...input, idempotencyKey: randomUUID() }), /提醒已失效/);
  const corrected = await insights.updateOutcome(userId, first.event.id, { outcome: "discarded", version: 1 });
  assert.equal(corrected.kind, "updated");
  assert.equal((await query("SELECT outcome_type FROM proactive_intervention_outcomes WHERE source_id=?", [first.event.id]))[0].outcome_type, "inventory_discarded");
  await insights.updateOutcome(userId, first.event.id, { outcome: "unknown", version: 2 });
  assert.equal((await query("SELECT COUNT(*) n FROM proactive_intervention_outcomes WHERE source_id=?", [first.event.id]))[0].n, 0);
  await insights.updateOutcome(userId, first.event.id, { outcome: "used", version: 3 });
  assert.equal((await query("SELECT outcome_type FROM proactive_intervention_outcomes WHERE source_id=?", [first.event.id]))[0].outcome_type, "inventory_used");
  const metrics = (await notifications.adminData(new Date(now-1000).toISOString())).interventionMetrics!;
  assert(metrics.inventory_used >= 1); assert(metrics.timely_used >= 1); assert(metrics.expiry_visible >= 1);
}
