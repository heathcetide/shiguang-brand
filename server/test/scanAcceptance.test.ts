import { inventoryPhotoKey } from "../src/modules/inventory/scanIdentity.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyScanAcceptance } from "../src/modules/inventory/scanAcceptance.js";

test("mixed scan acceptance requires traceable complete unambiguous fields, not just confidence", () => {
  const base = { foodName: "鸡蛋", quantity: "6个", suggestedStorageLocation: "冷藏", confidence: 0.99 };
  const result = classifyScanAcceptance("job", [base,
    { ...base, foodName: "米", quantity: "一袋" },
    { ...base, foodName: "苹果", suggestedStorageLocation: "" },
    { ...base, foodName: "牛奶或豆奶" },
    { ...base, foodName: "已有番茄" }], ["已有番茄"]);
  assert.deepEqual(result.map(item => item.acceptance), ["automatic", "review", "review", "review", "review"]);
  assert.equal(result[0].sourceItemId, "job:0");
  assert.equal(result[0].estimatedExpireDays, null);
  assert.equal(result[0].fieldEvidence.expiration_date.status, "unknown");
  assert.equal(result[0].fieldEvidence.quantity.status, "estimated");
  assert.equal(classifyScanAcceptance("", [base], [])[0].acceptance, "review");
  assert(classifyScanAcceptance("job", [base, base], []).every(item => item.acceptance === "review"));
});

test("identical photo bytes share identity independent of base64 framing", () => {
  assert.equal(inventoryPhotoKey("aGVsbG8="), inventoryPhotoKey("data:image/jpeg;base64,aGVs bG8="));
  assert.notEqual(inventoryPhotoKey("aGVsbG8="), inventoryPhotoKey("d29ybGQ="));
});

const completeItem = { foodName: "牛奶", quantity: "1升", suggestedStorageLocation: "冷藏", confidence: 0.99 };
const scanUnits = ["g", "kg", "ml", "l", "克", "千克", "毫升", "升", "个", "枚", "只", "袋", "盒", "瓶", "罐", "份"];

for (const amount of ["0.5", "0.25", "0.05", "1", "12.5", "00.5", "半"]) {
  test(`scan accepts complete positive quantity ${amount} with each supported unit`, () => {
    for (const unit of scanUnits) {
      const quantity = `${amount}${unit}`;
      const [item] = classifyScanAcceptance("job", [{ ...completeItem, quantity }], []);
      assert.equal(item.acceptance, "automatic", quantity);
      assert.deepEqual(item.reasons, []);
      assert.equal(item.quantity, quantity);
      assert.deepEqual(item.fieldEvidence.quantity, { status: "estimated", source: "recognition" });
    }
  });
}

for (const amount of ["0", "0.0", "00", "00.00", "-1", "1e3", "NaN", "Infinity", "9".repeat(309), `0.${"0".repeat(323)}1`]) {
  test(`scan reviews non-positive or invalid quantity ${amount.slice(0, 20)}`, () => {
    for (const unit of scanUnits) {
      const quantity = `${amount}${unit}`;
      const [item] = classifyScanAcceptance("job", [{ ...completeItem, quantity }], []);
      assert.equal(item.acceptance, "review", quantity);
      assert.deepEqual(item.reasons, ["数量需要确认"]);
    }
  });
}

test("scan requires a complete, supported quantity rather than guessing missing or ambiguous values", () => {
  for (const quantity of [undefined, null, 0, "", " ", "适量", "数量未知", "一袋", "约0.5kg", "0.5kg左右", "0.5-1kg", "1/2kg", "1kg或2kg", "1kg 2g", "1", "kg", ".5kg", "1.kg", "+1kg", "1公斤", "1片"]) {
    const [item] = classifyScanAcceptance("job", [{ ...completeItem, quantity }], []);
    assert.equal(item.acceptance, "review", String(quantity));
    assert.deepEqual(item.reasons, ["数量需要确认"]);
  }
  assert.equal(classifyScanAcceptance("job", [{ ...completeItem, quantity: " 0.25 KG " }], [])[0].acceptance, "automatic");
});

test("positive fractional quantities do not bypass other acceptance gates", () => {
  const base = { ...completeItem, quantity: "0.25升" };
  for (const [jobId, item, existingNames, reason] of [
    ["", base, [], "缺少识别任务依据"],
    ["job", { ...base, confidence: 0.89 }, [], "识别把握不足"],
    ["job", { ...base, confidence: undefined }, [], "识别把握不足"],
    ["job", { ...base, suggestedStorageLocation: "" }, [], "存放位置未知"],
    ["job", { ...base, foodName: "牛奶或豆奶" }, [], "名称存在歧义"],
    ["job", base, ["牛奶"], "可能与其他批次重叠"],
  ] as const) {
    const [result] = classifyScanAcceptance(jobId, [item], [...existingNames]);
    assert.equal(result.acceptance, "review");
    assert.deepEqual(result.reasons, [reason]);
  }
  assert(classifyScanAcceptance("job", [base, base], []).every(item => item.acceptance === "review"));
});
