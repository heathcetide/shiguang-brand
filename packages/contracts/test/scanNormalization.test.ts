import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInventoryScanItems } from "../src/scanNormalization.ts";

test("scan normalization keeps values, evidence and missing fields consistent", () => {
  const unknown = { status: "unknown", source: "unknown" };
  const recognized = { status: "estimated", source: "recognition" };
  for (const input of [undefined, null, {}, "鸡蛋", [null, {}, { foodName: " " }, { foodName: 1 }]]) {
    assert.deepEqual(normalizeInventoryScanItems(input), []);
  }
  for (const value of [undefined, null, " ", "柜子", -1, 0, 1.5, 366, NaN, Infinity]) {
    const [item] = normalizeInventoryScanItems([{ foodName: " 鸡蛋 ", quantity: value,
      suggestedStorageLocation: value, estimatedExpireDays: value, confidence: value }]);
    const quantity = typeof value === "string" ? value.trim() : "";
    assert.deepEqual(item, {
      foodName: "鸡蛋", quantity, suggestedStorageLocation: "", estimatedExpireDays: null,
      confidence: value === 0 ? 0 : null,
      fieldEvidence: { food_name: recognized, quantity: quantity ? recognized : unknown,
        storage_location: unknown, expiration_date: unknown },
      missingFields: [...(quantity ? [] : ["数量"]), "存放位置", "保质期"],
    });
  }
  for (const suggestedStorageLocation of ["冷藏", "冷冻", "常温"]) {
    for (const estimatedExpireDays of [1, 365]) {
      const input = { foodName: "鸡蛋", quantity: " 半盒 ", suggestedStorageLocation, estimatedExpireDays, confidence: 1 };
      assert.deepEqual(normalizeInventoryScanItems([input]), [{
        ...input, quantity: "半盒", missingFields: [],
        fieldEvidence: { food_name: recognized, quantity: recognized, storage_location: recognized, expiration_date: recognized },
      }]);
    }
  }
  const items = Array.from({ length: 31 }, (_, index) => ({ foodName: String(index) }));
  assert.deepEqual(normalizeInventoryScanItems([null, ...items]).map(item => item.foodName), items.slice(0, 30).map(item => item.foodName));
});
