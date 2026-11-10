import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryCreateSchema,
  inventoryItemSchema,
  inventoryUpdateSchema,
  shoppingInventoryImportSchema,
} from "../src/index.ts";
import { createInventoryOpenApiDocument } from "../src/openapi.ts";

const validCreate = {
  food_name: "番茄",
  category: "蔬菜",
  expiration_date: "2026-09-05",
  storage_location: "冷藏" as const,
};

test("shopping intake validates unique versioned source rows and preserves legacy imports", () => {
  const input = { idempotency_key: "shopping-atomic-import-001", items: [validCreate] };
  assert.ok(shoppingInventoryImportSchema.safeParse(input).success);
  const source = { id: "00000000-0000-4000-8000-000000000001", version: 1 };
  assert.ok(shoppingInventoryImportSchema.safeParse({ ...input, shopping_items: [source] }).success);
  for (const shopping_items of [[], [source, source], [{ ...source, version: 0 }], [{ ...source, id: "invalid" }]]) {
    assert.equal(shoppingInventoryImportSchema.safeParse({ ...input, shopping_items }).success, false);
  }
  assert.equal(shoppingInventoryImportSchema.safeParse({ ...input, items: [validCreate, validCreate], shopping_items: [source, source] }).success, false);
});

test("inventory requests use strict shared validation", () => {
  assert.equal(inventoryCreateSchema.parse(validCreate).quantity, "1份");
  assert.throws(() => inventoryCreateSchema.parse({ ...validCreate, unknown: true }));
  assert.throws(() => inventoryCreateSchema.parse({ ...validCreate, quantity_value: 2 }));
  assert.deepEqual(inventoryUpdateSchema.parse({ storage_location: "冷冻" }), { storage_location: "冷冻" });
});

test("inventory responses reject wrong types and remove database-only fields", () => {
  const parsed = inventoryItemSchema.parse({
    id: 1,
    user_id: 99,
    food_name: "番茄",
    category: "蔬菜",
    quantity: "2个",
    expiration_date: "2026-09-05",
    storage_location: "冷藏",
    image_url: null,
    is_available: true,
    version: 1,
  });
  assert.equal("user_id" in parsed, false);
  assert.throws(() => inventoryItemSchema.parse({ ...parsed, is_available: 1 }));
});

test("versioned OpenAPI contains every inventory operation", () => {
  const document = createInventoryOpenApiDocument();
  assert.equal(document.openapi, "3.1.0");
  assert.ok(document.paths["/api/v1/inventory"]?.get);
  assert.ok(document.paths["/api/v1/inventory/{id}"]?.put);
  assert.ok(document.paths["/api/v1/inventory/consume"]?.post);
});
