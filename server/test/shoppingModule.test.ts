import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ShoppingRepository } from "../src/modules/shopping/repository.js";
import { ShoppingService } from "../src/modules/shopping/service.js";
import type { ShoppingItem } from "../src/modules/shopping/types.js";

const item: ShoppingItem = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "番茄",
  amount: "2个",
  category: "蔬菜",
  checked: false,
  version: 1,
  createdAt: "2026-09-01 10:00:00",
  updatedAt: "2026-09-01 10:00:00",
};

function fakeRepository(overrides: Partial<ShoppingRepository> = {}) {
  const repository: ShoppingRepository = {
    list: async () => [item],
    create: async () => item,
    update: async () => ({ ...item, version: 2 }),
    remove: async () => true,
    importItems: async () => undefined,
    ...overrides,
  };
  return repository;
}

describe("shopping module", () => {
  test("turns stale writes into a stable domain conflict", async () => {
    const service = new ShoppingService(fakeRepository({ update: async () => null }));
    await assert.rejects(
      () => service.update(item.id, 1, { version: 1, checked: true }),
      (error: any) => error.code === "SHOPPING_ITEM_VERSION_CONFLICT" && error.status === 409,
    );
  });

  test("turns missing deletes into a stable not-found error", async () => {
    const service = new ShoppingService(fakeRepository({ remove: async () => false }));
    await assert.rejects(
      () => service.remove(item.id, 1),
      (error: any) => error.code === "SHOPPING_ITEM_NOT_FOUND" && error.status === 404,
    );
  });

  test("derives deterministic import client ids for idempotent retries", async () => {
    let imported: Parameters<ShoppingRepository["importItems"]>[1] = [];
    const service = new ShoppingService(fakeRepository({
      importItems: async (_userId, items) => { imported = items; },
    }));
    const result = await service.importItems(1, {
      importKey: "shopping-import-key-0001",
      items: [{ name: "牛奶", amount: "1盒", category: "乳制品", checked: false }],
    });
    assert.equal(imported[0]?.clientId, "shopping-import-key-0001:牛奶:1盒");
    assert.deepEqual(result, { items: [item] });
  });
});
