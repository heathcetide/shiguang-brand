import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { InventoryRepository } from "../../src/modules/inventory/repository.js";
import type { ShoppingRepository } from "../../src/modules/shopping/repository.js";
import { InventoryDomainError } from "../../src/modules/inventory/errors.js";

/** Identical transaction assertions for both real database drivers. */
export async function verifyShoppingIntake(inventory: InventoryRepository, shopping: ShoppingRepository, userId: number, otherUserId: number) {
  const create = (checked = true, owner = userId) => shopping.create(randomUUID(), owner, {
    name: "采购事务测试", amount: "2个", category: "蔬菜", checked,
  });
  const stock = { food_name: "采购事务测试", category: "蔬菜", quantity: "2个", expiration_date: "2099-12-31", storage_location: "冷藏" as const };
  const source = (row: { id: string; version: number }) => ({ id: row.id, version: row.version });
  const conflict = (error: unknown) => error instanceof InventoryDomainError && error.code === "SHOPPING_ITEM_CONFLICT";
  const countBefore = (await inventory.list(userId)).length;
  const purchased = await create();
  const request = { idempotency_key: randomUUID(), items: [stock], shopping_items: [source(purchased)] };
  const responses = await Promise.all([inventory.importShoppingList(userId, request), inventory.importShoppingList(userId, request)]);
  assert.deepEqual(responses.map(result => result.repeated).sort(), [false, true]);
  assert.equal(responses[0].items[0].id, responses[1].items[0].id);
  assert.equal((await shopping.list(userId)).some(row => row.id === purchased.id), false);
  await assert.rejects(() => inventory.importShoppingList(userId, { ...request, idempotency_key: randomUUID() }), conflict);
  assert.equal((await inventory.list(userId)).length, countBefore + 1);

  // Whichever request claims the shared source first wins, even with new keys.
  const concurrent = await create();
  const results = await Promise.allSettled([0, 1].map(() => inventory.importShoppingList(userId, {
    idempotency_key: randomUUID(), items: [stock], shopping_items: [source(concurrent)],
  })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failed = results.find(result => result.status === "rejected");
  assert.ok(failed?.status === "rejected" && conflict(failed.reason));
  assert.equal((await inventory.list(userId)).length, countBefore + 2);

  // Sort as the PostgreSQL repository does: the first claim must be rolled back
  // when the second source is stale, so the entire batch remains retryable.
  const rows = (await Promise.all([create(), create()])).sort((a, b) => a.id.localeCompare(b.id));
  const stale = { idempotency_key: randomUUID(), items: [stock, stock], shopping_items: [source(rows[0]), { ...source(rows[1]), version: rows[1].version + 1 }] };
  await assert.rejects(() => inventory.importShoppingList(userId, stale), conflict);
  for (const row of rows) assert.deepEqual((await shopping.list(userId)).find(item => item.id === row.id), row);
  assert.equal((await inventory.list(userId)).length, countBefore + 2);
  const corrected = await inventory.importShoppingList(userId, { ...stale, shopping_items: rows.map(source) });
  assert.equal(corrected.repeated, false);
  assert.equal(corrected.items.length, 2);

  for (const row of [await create(false), await create(true, otherUserId)]) {
    await assert.rejects(() => inventory.importShoppingList(userId, {
      idempotency_key: randomUUID(), items: [stock], shopping_items: [source(row)],
    }), conflict);
  }
  assert.equal((await inventory.list(userId)).length, countBefore + 4);
}
