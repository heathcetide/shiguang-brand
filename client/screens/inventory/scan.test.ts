import { normalizeInventoryScanFoods } from "../ai-assistant/inventoryScan";
import { mergeDetectedFoods, normalizeDetectedFoods } from "./scan";

test("restored recognition keeps stable item identities without merging separate batches", () => {
  const input = [{ foodName: "大米", quantity: "1袋" }, { foodName: "大米", quantity: "2袋" }];
  const first = normalizeDetectedFoods(input, "job-one");
  expect(normalizeDetectedFoods(input, "job-one").map(item => item.id)).toEqual(first.map(item => item.id));
  const result = mergeDetectedFoods([...first, ...first]);
  expect(result).toHaveLength(2);
  expect(result.map(item => item.quantity)).toEqual(["1袋", "2袋"]);
  expect(result.every(item => item.missingFields?.includes("是否为独立批次"))).toBe(true);
  expect(mergeDetectedFoods([...first, ...normalizeDetectedFoods(input, "job-two")])).toHaveLength(4);
});

test("inventory and assistant restoration use the same source identity for a scan", () => {
  const input = [{ foodName: "鸡蛋", quantity: "2个" }, { foodName: "鸡蛋", quantity: "3个" }];
  expect(normalizeInventoryScanFoods(input, "shared-scan").map(item => item.id))
    .toEqual(normalizeDetectedFoods(input, "shared-scan").map(item => item.id));
});

test("unknown scan fields remain unknown in both entry points", () => {
  const input = [null, { foodName: "鸡蛋", confidence: null }, { foodName: "大米", quantity: "  ", suggestedStorageLocation: "柜子", estimatedExpireDays: -4, confidence: 2 }];
  const result = normalizeDetectedFoods(input, "unknown-scan");
  expect(result).toHaveLength(2);
  for (const item of result) {
    expect(item.quantity).toBe("");
    expect(item.suggestedStorageLocation).toBe("");
    expect(item.estimatedExpireDays).toBeNull();
    expect(item.confidence).toBeNull();
    expect(item.fieldEvidence?.quantity).toEqual({ status: "unknown", source: "unknown" });
    expect(item.missingFields).toEqual(["数量", "存放位置", "保质期"]);
  }
  expect(normalizeInventoryScanFoods(input, "unknown-scan")).toEqual(result);
});

test("recognized values survive restoration without replacing their units or dates", () => {
  const input = [{ foodName: "大米", quantity: " 半袋 ", suggestedStorageLocation: "常温", estimatedExpireDays: 12, confidence: 0.95 }];
  const [item] = normalizeDetectedFoods(input, "known-scan");
  expect(item.quantity).toBe("半袋");
  expect(item.suggestedStorageLocation).toBe("常温");
  expect(item.estimatedExpireDays).toBe(12);
  expect(item.confidence).toBe(0.95);
  expect(item.fieldEvidence?.quantity).toEqual({ status: "estimated", source: "recognition" });
  expect(item.missingFields).toEqual([]);
});
