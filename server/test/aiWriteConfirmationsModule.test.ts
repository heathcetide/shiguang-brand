import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AIWriteConfirmationsRepository } from "../src/modules/aiWriteConfirmations/repository.js";
import { AIWriteConfirmationsService } from "../src/modules/aiWriteConfirmations/service.js";
import type { AIWriteConfirmation, PreparedAIWrite } from "../src/modules/aiWriteConfirmations/types.js";

function confirmation(overrides: Partial<AIWriteConfirmation> = {}): AIWriteConfirmation {
  return { id: "confirmation-1", userId: 42, action: "add_inventory_item", payload: { name: "番茄", quantity: "2个",
    location: "冷藏", expireDays: 5 }, status: "preview", committedResult: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides };
}

function repository(row: AIWriteConfirmation | null, onCommit?: (prepared: PreparedAIWrite) => void): AIWriteConfirmationsRepository {
  return {
    createPreview: async () => ({ expiresAt: new Date(Date.now() + 900_000).toISOString() }),
    confirmation: async (_id, userId) => row?.userId === userId ? row : null,
    commit: async (input) => { onCommit?.(input.prepared); return { kind: "committed", result:
      { action: input.prepared.action, id: 7, message: input.prepared.message } }; },
  };
}

describe("AI write confirmations module", () => {
  test("creates opaque previews without changing business data", async () => {
    const created: Array<Record<string, unknown>> = [];
    const subject = new AIWriteConfirmationsService({ ...repository(null), createPreview: async (input) => {
      created.push(input); return { expiresAt: "2026-09-01T12:15:00.000Z" };
    } });
    const preview = await subject.createPreview({ userId: 42, action: "add_inventory_item", payload: { name: "番茄" } });
    assert.match(preview.confirmationId, /^[0-9a-f-]{36}$/);
    assert.equal(created[0]?.userId, 42);
    assert.equal(preview.expiresAt, "2026-09-01T12:15:00.000Z");
  });

  test("normalizes inventory and kitchenware writes before persistence", async () => {
    const prepared: PreparedAIWrite[] = [];
    const inventory = new AIWriteConfirmationsService(repository(confirmation(), (write) => prepared.push(write)));
    assert.equal((await inventory.commit({ userId: 42, confirmationId: "confirmation-1", idempotencyKey: "key-1" })).id, 7);
    assert.equal(prepared[0]?.kind, "inventory");
    assert.equal(prepared[0]?.message, "已加入库存：番茄");
    const kitchenware = new AIWriteConfirmationsService(repository(confirmation({ action: "add_kitchenware_item",
      payload: { name: "炒锅", category: "invalid", status: "invalid", note: "a".repeat(400) } }), (write) => prepared.push(write)));
    await kitchenware.commit({ userId: 42, confirmationId: "confirmation-1", idempotencyKey: "key-2" });
    const write = prepared[1];
    assert(write?.kind === "kitchenware");
    assert.equal(write.category, "其他");
    assert.equal(write.status, "良好");
    assert.equal(write.note?.length, 300);
  });

  test("normalizes meal dates and rejects empty health writes", async () => {
    const prepared: PreparedAIWrite[] = [];
    const meal = new AIWriteConfirmationsService(repository(confirmation({ action: "record_diet_meal",
      payload: { foodName: "燕麦", mealType: "invalid", calories: -1, recordedAt: "2026-09-01", recordedTime: "08:30" } }),
    (write) => { prepared.push(write); }));
    await meal.commit({ userId: 42, confirmationId: "confirmation-1", idempotencyKey: "key-3" });
    const mealWrite = prepared[0];
    assert(mealWrite?.kind === "diet");
    assert.equal(mealWrite.mealType, "午餐");
    assert.equal(mealWrite.calories, null);
    const health = new AIWriteConfirmationsService(repository(confirmation({ action: "record_health_log", payload: {} })));
    await assert.rejects(() => health.commit({ userId: 42, confirmationId: "confirmation-1", idempotencyKey: "key-4" }),
      /缺少可记录的健康数据/);
  });

  test("maps ownership, lifecycle, expiry, and repeated outcomes", async () => {
    await assert.rejects(() => new AIWriteConfirmationsService(repository(null)).commit(
      { userId: 42, confirmationId: "missing", idempotencyKey: "key-5" }), /不存在或无权/);
    await assert.rejects(() => new AIWriteConfirmationsService(repository(confirmation({ status: "cancelled" }))).commit(
      { userId: 42, confirmationId: "confirmation-1", idempotencyKey: "key-6" }), /已失效/);
    const repeated = new AIWriteConfirmationsService(repository(confirmation({ status: "committed",
      committedResult: { action: "add_inventory_item", id: 9 } })));
    assert.equal((await repeated.commit({ userId: 42, confirmationId: "confirmation-1", idempotencyKey: "key-7" })).id, 9);
    const expiredRepository = repository(confirmation());
    expiredRepository.commit = async () => ({ kind: "expired" });
    await assert.rejects(() => new AIWriteConfirmationsService(expiredRepository).commit(
      { userId: 42, confirmationId: "confirmation-1", idempotencyKey: "key-8" }), /确认已过期/);
  });
});
