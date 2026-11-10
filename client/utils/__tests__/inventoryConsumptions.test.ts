import { combineInventoryDeductions, ingredientConsumptionRequests, inventoryPreviewWarnings } from "../inventoryConsumptions";
const deduction = (amount: number, mode: "amount" | "all" = "amount") => ({
  item_id: 1, version: 1, mode, amount_value: amount, unit: "kg" as const,
  food_name: "盐", expiration_date: "", batch_code: null,
});
test("cooking combines decimal deductions without sending response-only fields", () => {
  expect(combineInventoryDeductions([deduction(0.1), deduction(0.2)])).toEqual([
    { item_id: 1, version: 1, mode: "amount", amount_value: 0.3, unit: "kg" },
  ]);
  expect(combineInventoryDeductions([deduction(0.0002)])).toEqual([
    { item_id: 1, version: 1, mode: "amount", amount_value: 0.0002, unit: "kg" },
  ]);
  expect(combineInventoryDeductions([deduction(0.1), deduction(0.2, "all")])).toEqual([
    { item_id: 1, version: 1, mode: "all" },
  ]);
});
test("cooking rejects stale batch versions and unrepresentable sums", () => {
  expect(() => combineInventoryDeductions([deduction(0.1), { ...deduction(0.1), version: 2 }])).toThrow("库存已变化");
  expect(() => combineInventoryDeductions([deduction(1), deduction(1e-20)])).toThrow("计量精度");
});


test("mixed cooking demands retain unknown quantities and reject ranges or signed text", () => {
  const result = ingredientConsumptionRequests([{ name: "鸡蛋", amount: "2枚" }, { name: "盐", amount: "适量" }]);
  expect(result.requests).toEqual([{ food_name: "鸡蛋", amount_value: 2, unit: "piece" }]);
  expect(result.unknown).toEqual(["盐"]);
  for (const amount of ["-2个", "1-2个", "约2个", "2个以上", "2个/餐", "2个和3个", "0个"]) {
    expect(ingredientConsumptionRequests([{ name: "鸡蛋", amount }])).toEqual({ requests: [], unknown: ["鸡蛋"] });
  }
});
test("pre-cooking warnings distinguish fresh shortages, unknown conversions and explicit sufficient quantities", () => {
  const row = { food_name: "鸡蛋", requested_value: 4, unit: "piece" as const, covered_value: 3, missing_value: 1, fully_covered: false, deductions: [] };
  expect(inventoryPreviewWarnings({ items: [{ ...row, quantity_status: "insufficient" }] }, ["盐"])).toEqual(["盐用量未知，请核对实际用量", "鸡蛋缺 1个"]);
  expect(inventoryPreviewWarnings({ items: [{ ...row, quantity_status: "unknown" }] })).toEqual(["鸡蛋库存数量或换算依据未知，请核对实际用量"]);
  expect(inventoryPreviewWarnings({ items: [{ ...row, covered_value: 4, missing_value: 0, fully_covered: true, quantity_status: "sufficient" }] })).toEqual([]);
});
