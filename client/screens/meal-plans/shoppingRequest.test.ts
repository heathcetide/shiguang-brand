import { createShoppingRequestKeys, personalShoppingMessage } from "./shoppingRequest";

test("shopping retries and concurrent clicks share a key; success rotates only its scope", () => {
  const keys = createShoppingRequestKeys();
  const first = keys.get("alice","meal",1);
  expect(keys.get("alice","meal",1)).toBe(first);
  expect(keys.get("bob","meal",1)).not.toBe(first);
  expect(keys.get("alice","other",1)).not.toBe(first);
  expect(keys.get("alice","meal",2)).not.toBe(first);
  keys.complete("alice","meal",1,first);
  const second = keys.get("alice","meal",1);
  expect(second).not.toBe(first);
  keys.complete("alice","meal",1,first);
  expect(keys.get("alice","meal",1)).toBe(second);
});


test("shopping messages only certify explicit current-plan coverage", () => {
  const covered = personalShoppingMessage({ added: 0,coverage: "covered" });
  expect(covered).toContain("本餐单库存核算覆盖本餐需求");
  expect(covered).toContain("未预留库存或抵扣其他餐单需求");
  const review = personalShoppingMessage({ added: 0,coverage: "needs_review",reviewItems: [{ name: "鸡蛋",reason: "请核对数量" }] });
  expect(review).toContain("本次未新增采购项");
  expect(review).toContain("鸡蛋：请核对数量");
  expect(review).not.toContain("覆盖本餐需求");
  const partial = personalShoppingMessage({ added: 2,coverage: "needs_review",reviewItems: [{ name: "米",reason: "单位无法换算" }] });
  expect(partial).toContain("已加入 2 个缺失食材");
  expect(partial).toContain("米：单位无法换算");
  const legacy = personalShoppingMessage({ added: 0 });
  expect(legacy).toContain("本次未新增采购项");
  expect(legacy).not.toContain("覆盖本餐需求");
});
