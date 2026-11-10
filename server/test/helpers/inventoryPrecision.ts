import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { InventoryRepository } from "../../src/modules/inventory/repository.js";
import { InventoryService } from "../../src/modules/inventory/service.js";

type Query = (sql: string, values?: (string | number)[]) => Promise<Record<string, unknown>[]>;

/** Runs unchanged against real SQLite and PostgreSQL repositories and transaction logs. */
export async function verifyInventoryPrecision(repository: InventoryRepository, userId: number, query: Query) {
  const service = new InventoryService(repository);
  const prefix = "precision:" + randomUUID();
  const create = (suffix: string, value: number, unit: "kg" | "l" | "bag") => repository.create(userId, {
    food_name: prefix + suffix, category: "其他", quantity: value + unit,
    quantity_value: value, quantity_unit: unit, expiration_date: "2099-12-31", storage_location: "常温",
  });
  for (const [unit, requestUnit, amount, remaining, used] of [
    ["kg", "g", 0.2, 0.9998, 0.0002],
    ["l", "ml", 0.5, 0.9995, 0.0005],
  ] as const) {
    const item = await create(unit, 1, unit);
    const preview = await service.previewConsumption(userId, { items: [{ food_name: item.food_name, amount_value: amount, unit: requestUnit }] });
    assert.equal(preview.items[0].fully_covered, true);
    const deduction = preview.items[0].deductions[0];
    assert.equal(deduction.amount_value, used);
    const input = { idempotency_key: prefix + unit, source: "cooking" as const,
      items: [{ item_id: deduction.item_id, version: deduction.version, mode: deduction.mode, amount_value: deduction.amount_value, unit: deduction.unit }] };
    const result = await service.consume(userId, input);
    assert.equal(result.changes[0].quantity_after, remaining);
    assert.equal(result.changes[0].consumed_value, used);
    assert.equal(result.items[0].quantity, remaining + (unit === "l" ? "L" : unit));
    const replay = await service.consume(userId, input);
    assert.deepEqual(replay, { ...result, repeated: true });
    const logs = (await service.history(userId, item.id)).filter(entry => entry.action === "consume_partial");
    assert.equal(logs.length, 1);
    assert.deepEqual([logs[0].quantity_before, logs[0].quantity_after, logs[0].delta_value], [1, remaining, -used]);
    await assert.rejects(() => service.consume(userId, { ...input, idempotency_key: prefix + unit + ":stale" }),
      (error: unknown) => (error as { code: string }).code === "INVENTORY_VERSION_CONFLICT");
  }
  const counted = await create("bag", 0.3, "bag");
  for (const [index, amount] of [0.1, 0.2].entries()) {
    const result = await service.consume(userId, { idempotency_key: prefix + ":decimal:" + index, source: "manual",
      items: [{ item_id: counted.id, version: index + 1, mode: "amount", amount_value: amount, unit: "bag" }] });
    assert.equal(result.changes[0].quantity_after, index === 0 ? 0.2 : 0);
  }
  assert.equal((await repository.findOwned(userId, counted.id))?.is_available, false);

  const first = await create("rollback-first", 1, "kg");
  const second = await create("rollback-second", 1, "kg");
  const counts = async () => Promise.all(["inventory_change_logs", "inventory_consumption_requests", "plan_maintenance_events"].map(async table =>
    Number((await query("SELECT COUNT(*) AS n FROM " + table + " WHERE user_id=?", [userId]))[0].n)));
  const before = { first: await repository.findOwned(userId, first.id), second: await repository.findOwned(userId, second.id), counts: await counts() };
  await assert.rejects(() => service.consume(userId, { idempotency_key: prefix + ":rollback", source: "manual", items: [
    { item_id: first.id, version: 1, mode: "amount", amount_value: 0.2, unit: "g" },
    { item_id: second.id, version: 1, mode: "amount", amount_value: 1e-20, unit: "kg" },
  ] }), (error: unknown) => (error as { code: string }).code === "QUANTITY_PRECISION_REQUIRED");
  assert.deepEqual({ first: await repository.findOwned(userId, first.id), second: await repository.findOwned(userId, second.id), counts: await counts() }, before);

  const missing = await service.previewConsumption(userId, { items: [{ food_name: prefix + ":absent", amount_value: 0.0001, unit: "kg" }] });
  assert.equal(missing.items[0].fully_covered, false);
  assert.equal(missing.items[0].missing_value, 0.0001);
}
