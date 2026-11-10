import assert from "node:assert/strict";
import { test } from "node:test";
import { preparedMealEventSchema, type PreparedMealAllocation } from "@dietdigidose/contracts";
import { chooseAllocation } from "../src/modules/mealAllocations/model.js";
const row: PreparedMealAllocation = { id: "allocation",planId: "plan",targetMealId: "dinner",preparedMealId: "meal",plannedDate: "2099-09-10",mealType: "dinner",servings: 1,remainingServings: 1,version: 1,status: "conflict" };
test("conflicting allocations can only be explicitly released without changing portions", () => {
  const input = { idempotency_key: "allocation-test-identity",version: 1,type: "eat" as const,servings: 1 };
  assert.throws(() => chooseAllocation([row],input,1),/冲突/);
  const release = preparedMealEventSchema.parse({ idempotency_key: input.idempotency_key,version: 1,type: "reschedule",allocation_id: row.id,allocation_version: 1,release_allocation: true });
  const next = chooseAllocation([row],release,1)!;
  assert.equal(next.status,"released"); assert.equal(next.remainingServings,1); assert.equal(row.version,1);
  assert.equal(preparedMealEventSchema.safeParse({ ...release,planned_date: "2099-09-11" }).success,false);
  assert.throws(() => chooseAllocation([row],{ ...release,allocation_version: 2 },1),/变化/);
});
test("unallocated portions are explicit and cannot consume another meal's reservation", () => {
  const active = { ...row,status: "active" as const };
  const input = { idempotency_key: "allocation-free-identity",version: 1,type: "eat" as const,servings: 1,allocation_id: null };
  assert.equal(chooseAllocation([active],input,2),null);
  assert.throws(() => chooseAllocation([active],{ ...input,servings: 1.5 },2),/不足/);
  assert.throws(() => chooseAllocation([active],{ ...input,servings: 1.000001 },2),/不足/);
  assert.equal(preparedMealEventSchema.safeParse({ ...input,allocation_version: 1 }).success,false);
});

test("clearing an allocated date requires explicit cancellation", () => {
  const input = { idempotency_key: "allocation-date-identity",version: 1,type: "reschedule" as const,planned_date: null,allocation_id: row.id,allocation_version: 1 };
  assert.throws(() => chooseAllocation([{ ...row,status: "active" }],input,1),/日期/);
});
