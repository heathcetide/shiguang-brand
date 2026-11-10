import { blankIntakeEntry, buildIntake, buildRecognitionIntake, quantityFields, summarizeInventoryText } from "./intakeEntry";

test("manual inventory keeps absent and approximate quantities unknown", () => {
  expect(quantityFields("")).toEqual({ quantity: "数量未知", quantity_value: null, quantity_unit: null });
  expect(quantityFields("大概 500g").quantity_value).toBeNull();
  expect(quantityFields("500g")).toEqual({ quantity: "500g", quantity_value: 500, quantity_unit: "g" });
  const input = buildIntake([{ ...blankIntakeEntry, foodName: "番茄" }], "stable-intake-request-1");
  expect(input.items[0]).toMatchObject({ quantity: "数量未知", quantity_value: null, quantity_unit: null, expiration_date: "", confirmed: true });
});

test("editable summaries preserve explicit quantities without inventing omitted values", () => {
  const items = summarizeInventoryText("家里有鸡蛋 3 个、番茄、两盒牛奶");
  expect(items.map(item => [item.foodName, item.quantity])).toEqual([["鸡蛋", "3 个"], ["番茄", ""], ["牛奶", "2盒"]]);
  expect(items.every(item => item.expirationDate === "")).toBe(true);
  expect(summarizeInventoryText("鸡蛋十五个")[0].quantity).toBe("");
  expect(summarizeInventoryText("鸡蛋大约3个")[0]).toMatchObject({ foodName: "鸡蛋大约3个", quantity: "" });
});

test("saving an incomplete summary is rejected before any request is sent", () => {
  expect(() => buildIntake([{ ...blankIntakeEntry }], "stable-intake-request-1")).toThrow();
  expect(() => buildIntake([], "stable-intake-request-1")).toThrow();
});

test("recognition submission preserves reviewed evidence, unknown expiry and stable item identity", () => {
  const food = { id: "scan:0", foodName: "米", quantity: "一袋", suggestedStorageLocation: "常温", estimatedExpireDays: null, selected: true, expirationDate: "",
    fieldEvidence: { quantity: { status: "unknown" as const, source: "user" as const } } };
  const request = buildRecognitionIntake([food, { ...food, id: "scan:1", selected: false }], "recognition-review-request", "image", "scan");
  expect(request.items).toHaveLength(1);
  expect(request).toMatchObject({ idempotency_key: "recognition-review-request", source_reference: "scan", items: [{ source_item_id: "scan:0", quantity: "一袋", quantity_value: null, expiration_date: "", field_evidence: food.fieldEvidence }] });
  expect(() => buildRecognitionIntake([{ ...food, suggestedStorageLocation: "" }], "recognition-review-request", "image", "scan")).toThrow("存放位置");
});

test("draft evidence accepts only structured schema values and old drafts stay unattested", () => {
  const { intakeDraftSchema } = require("./intakeEntry");
  const draft = { entries: [{ ...blankIntakeEntry, foodName: "米", quantity: "500g" }], pending: null };
  expect(intakeDraftSchema.parse(draft).entries[0].fieldEvidence).toBeUndefined();
  for (const evidence of [{status:"confirmed",source:"user"},{status:"known",source:"manual"},{status:"known",source:"user",note:"private raw input"}]) {
    expect(intakeDraftSchema.safeParse({...draft,entries:[{...draft.entries[0],fieldEvidence:{quantity:evidence}}]}).success).toBe(false);
  }
});

test("clearing name or invalidating a date drops previous confirmation", () => {
  const { changeManualEntry } = require("./intakeEntry");
  const known = changeManualEntry(blankIntakeEntry, {foodName:"米",expirationDate:"2026-11-01"});
  for (const expirationDate of ["", "2026-02-30", "2026-11"]) {
    const entry = changeManualEntry(known, { foodName:" ",expirationDate });
    expect(entry.fieldEvidence.food_name).toBeUndefined(); expect(entry.fieldEvidence.expiration_date).toBeUndefined();
  }
});
