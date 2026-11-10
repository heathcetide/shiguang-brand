import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateActiveReplacement, type ActiveReplacementArguments } from "../src/modules/mealPlans/activeReplacement.js";
import { revalidatePendingSuggestions, hasEffectiveMaintenanceEvents } from "../src/modules/planMaintenance/pendingSuggestions.js";
import type { MaintenanceInputSnapshot } from "../src/modules/planMaintenance/inputSnapshot.js";
import { activeReplacementFixture } from "./helpers/activeReplacementFixture.js";
import type { Row } from "../src/modules/mealPlans/formatters.js";

const fixture = activeReplacementFixture;
export { activeReplacementFixture as validPendingRevalidationFixture };
test("actual reviewed fixture passes, retains the other live meal and ignores stale draft targets", () => {
  const args = fixture(), before = structuredClone(args);
  const result = evaluateActiveReplacement(args);
  assert.deepEqual(result.checks, []); assert.equal(result.canApply, true);
  assert.equal(result.time?.schedule?.elapsedMinutes, 34);
  assert.equal(result.ingredientBudget.reduce((sum, part) => sum + part.covered_value, 0), 200);
  assert.equal(result.allocation?.constraints?.executionItems.a.recipeId, 2);
  assert.deepEqual(result.allocation?.constraints?.executionItems.b, (args.plan.constraints_json as Row).executionItems && ((args.plan.constraints_json as Row).executionItems as Row).b);
  assert.deepEqual(args, before);
});
test("whole live plan shortage and full-session overtime block the change", () => {
  const args = fixture(); args.data.inventory_items[0].quantity_value = 150;
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "inventory_shortage"));
  const fast = fixture(); ((fast.plan.constraints_json as Row).currentCookingDraft as Row).time = { budgetMinutes: 20 };
  assert(evaluateActiveReplacement(fast).checks.some(check => check.code === "time_exceeded"));
});
test("current allergies override stale permissive draft preferences", () => {
  const args = fixture(); args.data.user_health_profiles[0].allergies_json = [{ name: "米" }];
  ((args.plan.constraints_json as Row).currentCookingDraft as Row).effectivePreferences = { allergies: [] };
  const result = evaluateActiveReplacement(args); assert.equal(result.canApply, false);
  assert(result.checks.some(check => check.code === "hard_constraint"));
});
test("external commitments reserve only current plan window and current plan is not double charged", () => {
  const args = fixture(); args.data.inventory_items[0].quantity_value = 250;
  args.data.meal_plans = [{ id: "other", user_id: 1, status: "active" }, args.plan];
  args.data.meal_plan_items = [...args.items, ...["2026-10-20", "2026-10-22", "2026-10-24"].map((date, i) => ({ ...args.items[0], id: `ext${i}`, plan_id: "other", planned_date: date, ingredients_json: [{ name: "米", amount: "50g" }] }))];
  assert.equal(evaluateActiveReplacement(args).canApply, true);
  args.data.inventory_items[0].quantity_value = 249;
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "inventory_shortage"));
});
test("completed and skipped meals do not reuse ingredients; queued targets remain protected", () => {
  for (const status of ["completed", "skipped"]) {
    const args = fixture(); args.items[1].status = status; args.data.inventory_items[0].quantity_value = 100;
    const result = evaluateActiveReplacement(args); assert.equal(result.canApply, true); assert.equal(result.time?.schedule?.elapsedMinutes, 17);
  }
  const args = fixture(); args.items[0].status = "queued";
  assert.equal(evaluateActiveReplacement(args).checks[0].code, "item_locked");
});
test("missing execution, stale other recipe and household rows fail closed", () => {
  const missing = fixture(); (missing.plan.constraints_json as Row).executionItems = {};
  assert.equal(evaluateActiveReplacement(missing).checks[0].code, "execution_missing");
  const changed = fixture(); changed.items[1].steps_json = ["未审核修改"];
  assert(evaluateActiveReplacement(changed).checks.some(check => check.code === "execution_changed"));
  const dining = fixture(); dining.items[1].dining_json = { participants: [] };
  assert(evaluateActiveReplacement(dining).checks.some(check => check.code === "personal_only"));
});
test("missing prepared evidence and related allocations are pending, not successful confirmation", () => {
  const args = fixture(); delete args.data.prepared_meal_allocations;
  assert.equal(evaluateActiveReplacement(args).canApply, false);
  args.data.prepared_meal_allocations = [{ id: "allocation", plan_id: "p", status: "active", target_meal_id: "old-a" }];
  const before = structuredClone(args); assert(evaluateActiveReplacement(args).checks.some(check => check.code === "prepared_allocation_pending")); assert.deepEqual(args, before);
});
test("weekly unrelated prepared allocations remain unchanged and do not block replacement", () => {
  const args = fixture(); ((args.plan.constraints_json as Row).currentCookingDraft as Row).planningMode = "weekly";
  args.data.prepared_meal_allocations = [{ id: "unrelated", plan_id: "p", status: "active", target_meal_id: "prepared-only", planned_date: "2026-10-23", meal_type: "晚餐" }];
  const result = evaluateActiveReplacement(args); assert.equal(result.canApply, true); assert.equal(result.checks[0].severity, "info");
});
test("date and restoration operations also revalidate the current recipe", () => {
  const args = fixture(); args.items[0].status = "skipped"; args.input = { version: 1, status: "planned" };
  assert.equal(evaluateActiveReplacement(args).canApply, true);
  args.input.plannedDate = "2026-10-24";
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "invalid_scope"));
});

test("inventory evidence and availability cannot silently certify unverified stock", () => {
  const args = fixture(); args.data.inventory_change_logs = [{ id: 1, user_id: 1, inventory_item_id: 1, metadata_json: { inventory_version: 1, field_evidence: { quantity: { status: "unknown" } } } }];
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "inventory_unknown"));
  args.data.inventory_items[0].is_available = 0;
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "inventory_shortage"));
});
test("queue linkage protects a planned-looking target and weekly same-meal sessions share devices", () => {
  const args = fixture(); args.data.cooking_queue_items = [{ id: 1, source_plan_item_id: "a", status: "pending" }];
  assert.equal(evaluateActiveReplacement(args).checks[0].code, "item_locked");
  const weekly = fixture(); Object.assign((weekly.plan.constraints_json as Row).currentCookingDraft as Row, { planningMode: "weekly", time: { budgetMinutes: 60, sessionBudgetMinutes: 20 } });
  assert(evaluateActiveReplacement(weekly).checks.some(check => check.code === "time_exceeded"));
});

test("same-recipe edits cannot silently recapture changed steps or quantities", () => {
  const args = fixture(); args.input = { version: 1, mealType: "晚餐" }; args.items[0].steps_json = ["旧步骤已不同"];
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "execution_changed"));
});

test("revoked catalog governance cannot count as an available reviewed device", () => {
  const args = fixture(); args.data.kitchenware_catalog = [{ id: 1, name: "测试锅", quality_status: "needs_review" }];
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "schedule_incomplete"));
});

test("personal restore payload with unchanged null dining is accepted; stale item version is blocked", () => {
  const args = fixture(); args.items[0].status = "skipped";
  args.input = { version: 1, status: "planned", dining: null, plannedDate: "2026-10-21", mealType: "午餐" };
  assert.equal(evaluateActiveReplacement(args).canApply, true);
  args.input.version = 2;
  assert.equal(evaluateActiveReplacement(args).checks[0].code, "version_conflict");
});
test("legacy plans without production configuration cannot guess production from plan start", () => {
  const args = fixture(); delete (args.plan.constraints_json as Row).currentCookingDraft;
  const result = evaluateActiveReplacement(args); assert.equal(result.canApply, false);
  assert(result.checks.some(check => check.code === "production_configuration_missing"));
});

function makeSnapshot(args: ActiveReplacementArguments, changeOverrides?: Partial<Row>): { snapshot: MaintenanceInputSnapshot; compatibility: Map<number, { requirements: Row[]; blocking: Row[] }> } {
  const items = args.items.map(it => ({ ...it, user_id: 1 }));
  const change: Row = {
    id: "change-1",
    user_id: 1,
    plan_id: String(args.plan.id),
    item_id: String(args.itemId),
    status: "pending",
    before_version: 1,
    after_json: JSON.stringify({ version: 1, recipeId: 2, title: "替代菜2" }),
    ...changeOverrides,
  };
  const data: Record<string, Row[]> = {
    ...args.data,
    meal_plans: [args.plan],
    meal_plan_items: items,
    meal_plan_changes: [change],
    shopping_list_items: args.data.shopping_list_items ?? [],
    cooking_queue_items: args.data.cooking_queue_items ?? [],
  };
  const compatibility = new Map<number, { requirements: Row[]; blocking: Row[] }>();
  for (const r of args.data.recipes ?? []) {
    compatibility.set(Number(r.id), { requirements: [], blocking: [] });
  }
  const snapshot: MaintenanceInputSnapshot = {
    fingerprint: "f".repeat(64),
    recipeIds: (args.data.recipes ?? []).map(r => Number(r.id)),
    data,
  };
  return { snapshot, compatibility };
}

test("revalidatePendingSuggestions: checked writes only to notes, input deepEqual unchanged, no canApply/allocation", () => {
  const { snapshot, compatibility } = makeSnapshot(fixture());
  const beforeSnapshot = structuredClone(snapshot);
  const res = revalidatePendingSuggestions(snapshot, 1, compatibility, "2026-10-21");
  assert.deepEqual(snapshot, beforeSnapshot);
  assert.equal(res.evaluations.length, 1);
  const evalItem = res.evaluations[0];
  assert.equal(evalItem.outcome, "checked");
  assert.equal(evalItem.changeId, "change-1");
  assert.equal(evalItem.itemId, "a");
  assert.equal(evalItem.itemVersion, 1);
  assert.equal(evalItem.beforeVersion, 1);
  assert.equal(evalItem.checkedDate, "2026-10-21");
  assert.equal(evalItem.inputFingerprint, snapshot.fingerprint);
  assert.equal((evalItem as Record<string, unknown>).canApply, undefined);
  assert.equal((evalItem as Record<string, unknown>).allocation, undefined);
  assert.equal(res.checks.length, 0);
  assert.equal(res.notes.length, 1);
  assert.match(res.notes[0], /本次快照检查通过，仍待确认，接受时须重新预览/);
  assert.equal(snapshot.data.meal_plan_changes[0].status, "pending");
});

test("revalidatePendingSuggestions: inventory shortage blocks revalidation", () => {
  const args = fixture(); args.data.inventory_items[0].quantity_value = 150;
  const { snapshot, compatibility } = makeSnapshot(args);
  const res = revalidatePendingSuggestions(snapshot, 1, compatibility, "2026-10-21");
  assert.equal(res.evaluations[0].outcome, "blocked");
  assert.equal(res.checks.length, 1);
  assert.equal(res.notes.length, 0);
});

test("revalidatePendingSuggestions: candidate disabled or soft-deleted blocks revalidation", () => {
  const argsDisabled = fixture(); argsDisabled.data.recipes[1].status = "draft";
  const { snapshot: s1, compatibility: c1 } = makeSnapshot(argsDisabled);
  assert.equal(revalidatePendingSuggestions(s1, 1, c1, "2026-10-21").evaluations[0].outcome, "blocked");

  const argsDeleted = fixture(); argsDeleted.data.recipes[1].deleted_at = "2026-10-21T00:00:00Z";
  const { snapshot: s2, compatibility: c2 } = makeSnapshot(argsDeleted);
  assert.equal(revalidatePendingSuggestions(s2, 1, c2, "2026-10-21").evaluations[0].outcome, "blocked");
});

test("revalidatePendingSuggestions: missing candidate execution profile blocks revalidation", () => {
  const args = fixture(); delete (args.data.recipes[1] as Row).execution_json;
  const { snapshot, compatibility } = makeSnapshot(args);
  const res = revalidatePendingSuggestions(snapshot, 1, compatibility, "2026-10-21");
  assert.equal(res.evaluations[0].outcome, "blocked");
  assert.match(res.evaluations[0].checks[0], /缺少当前已审核的制作排程依据/);
});

test("revalidatePendingSuggestions: item version or payload version drift yields stale", () => {
  const args1 = fixture(); args1.items[0].version = 2;
  const { snapshot: s1, compatibility: c1 } = makeSnapshot(args1);
  assert.equal(revalidatePendingSuggestions(s1, 1, c1, "2026-10-21").evaluations[0].outcome, "stale");

  const { snapshot: s2, compatibility: c2 } = makeSnapshot(fixture(), { after_json: JSON.stringify({ version: 2, recipeId: 2 }) });
  assert.equal(revalidatePendingSuggestions(s2, 1, c2, "2026-10-21").evaluations[0].outcome, "stale");
});

test("revalidatePendingSuggestions: confirmed, purchased, queue, and dining items yield protected", () => {
  // Confirmed
  const argsConfirmed = fixture(); argsConfirmed.items[0].confirmed_at = "2026-10-20T00:00:00Z";
  const { snapshot: s1, compatibility: c1 } = makeSnapshot(argsConfirmed);
  assert.equal(revalidatePendingSuggestions(s1, 1, c1, "2026-10-21").evaluations[0].outcome, "protected");

  // Purchased / checked
  const argsPurchased = fixture();
  argsPurchased.data.shopping_list_items = [{ user_id: 1, client_id: "meal-plan:a:米", checked: 1, deleted_at: null }];
  const { snapshot: s2, compatibility: c2 } = makeSnapshot(argsPurchased);
  assert.equal(revalidatePendingSuggestions(s2, 1, c2, "2026-10-21").evaluations[0].outcome, "protected");

  // Queued via source_plan_item_id
  const argsQueue1 = fixture();
  argsQueue1.data.cooking_queue_items = [{ user_id: 1, source_plan_item_id: "a", status: "preparing", deleted_at: null }];
  const { snapshot: s3, compatibility: c3 } = makeSnapshot(argsQueue1);
  assert.equal(revalidatePendingSuggestions(s3, 1, c3, "2026-10-21").evaluations[0].outcome, "protected");

  // Queued via queue_item_id (even completed status)
  const argsQueue2 = fixture();
  argsQueue2.items[0].queue_item_id = "q-1";
  argsQueue2.data.cooking_queue_items = [{ id: "q-1", user_id: 1, status: "completed", deleted_at: null }];
  const { snapshot: s4, compatibility: c4 } = makeSnapshot(argsQueue2);
  assert.equal(revalidatePendingSuggestions(s4, 1, c4, "2026-10-21").evaluations[0].outcome, "protected");

  // Household / dining
  const argsHousehold = fixture(); argsHousehold.items[0].household_id = 99;
  const { snapshot: s5, compatibility: c5 } = makeSnapshot(argsHousehold);
  assert.equal(revalidatePendingSuggestions(s5, 1, c5, "2026-10-21").evaluations[0].outcome, "protected");

  // Real non-planned status (queued, cooking, completed, skipped) outputs protected
  for (const st of ["queued", "cooking", "completed", "skipped"]) {
    const argsStatus = fixture(); argsStatus.items[0].status = st;
    const { snapshot: sSt, compatibility: cSt } = makeSnapshot(argsStatus);
    assert.equal(revalidatePendingSuggestions(sSt, 1, cSt, "2026-10-21").evaluations[0].outcome, "protected");
  }
});

test("revalidatePendingSuggestions: dining JSON handling and malformed payload protection", () => {
  // JSON null dining is personal -> checked
  const argsNullDining = fixture(); argsNullDining.items[0].dining_json = "null";
  const { snapshot: s1, compatibility: c1 } = makeSnapshot(argsNullDining);
  assert.equal(revalidatePendingSuggestions(s1, 1, c1, "2026-10-21").evaluations[0].outcome, "checked");

  // Malformed dining fails closed -> protected
  const argsBadDining = fixture(); argsBadDining.items[0].dining_json = "{not_valid_json";
  const { snapshot: s2, compatibility: c2 } = makeSnapshot(argsBadDining);
  assert.equal(revalidatePendingSuggestions(s2, 1, c2, "2026-10-21").evaluations[0].outcome, "protected");

  // Malformed after_json records needs_review
  const { snapshot: s3, compatibility: c3 } = makeSnapshot(fixture(), { after_json: "invalid_json{" });
  const res3 = revalidatePendingSuggestions(s3, 1, c3, "2026-10-21");
  assert.equal(res3.evaluations[0].outcome, "needs_review");
  assert.match(res3.evaluations[0].checks[0], /数据无效/);

  // Unknown payload keys fail strict patch schema -> needs_review
  const { snapshot: s4, compatibility: c4 } = makeSnapshot(fixture(), { after_json: JSON.stringify({ version: 1, extraKey: "unexpected" }) });
  const res4 = revalidatePendingSuggestions(s4, 1, c4, "2026-10-21");
  assert.equal(res4.evaluations[0].outcome, "needs_review");
  assert.match(res4.evaluations[0].checks[0], /格式不符合规范/);

  // Normal non-replacement patch (e.g. date move only) is skipped
  const { snapshot: s5, compatibility: c5 } = makeSnapshot(fixture(), { after_json: JSON.stringify({ version: 1, plannedDate: "2026-10-22" }) });
  assert.equal(revalidatePendingSuggestions(s5, 1, c5, "2026-10-21").evaluations.length, 0);

  // Non-pending status and other users skipped
  const { snapshot: s6, compatibility: c6 } = makeSnapshot(fixture(), { status: "applied" });
  assert.equal(revalidatePendingSuggestions(s6, 1, c6, "2026-10-21").evaluations.length, 0);

  const { snapshot: s7, compatibility: c7 } = makeSnapshot(fixture(), { user_id: 2 });
  assert.equal(revalidatePendingSuggestions(s7, 1, c7, "2026-10-21").evaluations.length, 0);

  // Raw non-string scalar dining_json (e.g. number/boolean) is invalid/protected
  const argsScalarDining = fixture(); argsScalarDining.items[0].dining_json = 123 as unknown as string;
  const { snapshot: sScalar, compatibility: cScalar } = makeSnapshot(argsScalarDining);
  assert.equal(revalidatePendingSuggestions(sScalar, 1, cScalar, "2026-10-21").evaluations[0].outcome, "protected");

  // Plan with constraints_json = "null" catches evaluateActiveReplacement exception as needs_review,
  // while another valid suggestion in the same run is still evaluated; input snapshot is deeply unchanged;
  // neither canApply nor patch are output.
  const brokenArgs = fixture();
  brokenArgs.plan.constraints_json = "null";
  const validArgs = fixture();
  validArgs.plan.id = "p-valid";
  validArgs.items[0].id = "item-valid";
  validArgs.items[0].plan_id = "p-valid";
  (validArgs.plan.constraints_json as Row).executionItems = {
    "item-valid": { targetMealId: "item-valid", recipeId: 1, title: "菜1", servings: 2, recipeYield: 2, demands: [{ food_name: "米", amount_value: 100, unit: "g" }] },
  };

  const brokenChange: Row = {
    id: "change-broken",
    user_id: 1,
    plan_id: String(brokenArgs.plan.id),
    item_id: String(brokenArgs.itemId),
    status: "pending",
    before_version: 1,
    after_json: JSON.stringify({ version: 1, recipeId: 2, title: "替代菜2" }),
  };
  const validChange: Row = {
    id: "change-valid",
    user_id: 1,
    plan_id: "p-valid",
    item_id: "item-valid",
    status: "pending",
    before_version: 1,
    after_json: JSON.stringify({ version: 1, recipeId: 2, title: "替代菜2" }),
  };

  const dualSnapshot: MaintenanceInputSnapshot = {
    fingerprint: "d".repeat(64),
    recipeIds: [1, 2],
    data: {
      ...brokenArgs.data,
      meal_plans: [brokenArgs.plan, validArgs.plan],
      meal_plan_items: [
        { ...brokenArgs.items[0], user_id: 1 },
        { ...validArgs.items[0], user_id: 1 },
      ],
      meal_plan_changes: [brokenChange, validChange],
    },
  };
  const dualCompat = new Map<number, { requirements: Row[]; blocking: Row[] }>([
    [1, { requirements: [], blocking: [] }],
    [2, { requirements: [], blocking: [] }],
  ]);

  const beforeDual = structuredClone(dualSnapshot);
  const dualRes = revalidatePendingSuggestions(dualSnapshot, 1, dualCompat, "2026-10-21");

  assert.deepEqual(dualSnapshot, beforeDual);
  assert.equal(dualRes.evaluations.length, 2);

  const brokenEval = dualRes.evaluations.find(e => e.changeId === "change-broken");
  assert.ok(brokenEval);
  assert.equal(brokenEval.outcome, "needs_review");
  assert.equal(brokenEval.checks[0], "当前餐单执行依据不完整，无法完成本次检查");
  assert.equal((brokenEval as Record<string, unknown>).canApply, undefined);
  assert.equal((brokenEval as Record<string, unknown>).patch, undefined);

  const validEval = dualRes.evaluations.find(e => e.changeId === "change-valid");
  assert.ok(validEval);
  assert.equal(validEval.outcome, "checked");
  assert.equal((validEval as Record<string, unknown>).canApply, undefined);
  assert.equal((validEval as Record<string, unknown>).patch, undefined);
});

test("revalidatePendingSuggestions: missing compatibility entry for requirement fails closed", () => {
  const args = fixture();
  args.data.recipe_kitchenware_requirements = [{ recipe_id: 2, role: "primary" }];
  const { snapshot, compatibility } = makeSnapshot(args);
  compatibility.delete(2); // Missing compatibility entry
  const res = revalidatePendingSuggestions(snapshot, 1, compatibility, "2026-10-21");
  assert.equal(res.evaluations[0].outcome, "needs_review");
  assert.match(res.evaluations[0].checks[0], /缺少当前厨具治理校验结果/);
});

test("revalidatePendingSuggestions: validationFingerprint metadata handling, protection, and unknown field rejection", () => {
  const legalFingerprint = "a".repeat(64);

  // 1. 未保护合法建议（带 validationFingerprint 元数据）实际 checked，pending 状态与原餐次输入不变
  const validArgs = fixture();
  const originalItemBefore = structuredClone(validArgs.items[0]);
  const { snapshot: sValid, compatibility: cValid } = makeSnapshot(validArgs, {
    after_json: JSON.stringify({
      version: 1,
      recipeId: 2,
      title: "替代菜2",
      validationFingerprint: legalFingerprint,
    }),
  });
  const resValid = revalidatePendingSuggestions(sValid, 1, cValid, "2026-10-21");
  assert.equal(resValid.evaluations.length, 1);
  assert.equal(resValid.evaluations[0].outcome, "checked");
  assert.equal(resValid.evaluations[0].changeId, "change-1");
  assert.equal(resValid.notes.length, 1);
  assert.match(resValid.notes[0], /本次快照检查通过，仍待确认，接受时须重新预览/);
  assert.equal(sValid.data.meal_plan_changes[0].status, "pending");
  assert.deepEqual({ ...sValid.data.meal_plan_items[0], user_id: undefined }, { ...originalItemBefore, user_id: undefined });

  // 2. 带合法 fingerprint 的已确认建议 protected，pending 状态与原餐次输入不变
  const confirmedArgs = fixture();
  confirmedArgs.items[0].confirmed_at = "2026-10-20T00:00:00Z";
  const confirmedItemBefore = structuredClone(confirmedArgs.items[0]);
  const { snapshot: sConfirmed, compatibility: cConfirmed } = makeSnapshot(confirmedArgs, {
    after_json: JSON.stringify({
      version: 1,
      recipeId: 2,
      title: "替代菜2",
      validationFingerprint: legalFingerprint,
    }),
  });
  const resConfirmed = revalidatePendingSuggestions(sConfirmed, 1, cConfirmed, "2026-10-21");
  assert.equal(resConfirmed.evaluations[0].outcome, "protected");
  assert.ok(resConfirmed.evaluations[0].checks.some(c => c.includes("已确认")));
  assert.equal(sConfirmed.data.meal_plan_changes[0].status, "pending");
  assert.deepEqual({ ...sConfirmed.data.meal_plan_items[0], user_id: undefined }, { ...confirmedItemBefore, user_id: undefined });

  // 3. 带合法 fingerprint 的已采购建议 protected，pending 状态与原餐次输入不变
  const purchasedArgs = fixture();
  purchasedArgs.data.shopping_list_items = [
    { user_id: 1, client_id: "meal-plan:a:米", checked: 1, deleted_at: null },
  ];
  const purchasedItemBefore = structuredClone(purchasedArgs.items[0]);
  const { snapshot: sPurchased, compatibility: cPurchased } = makeSnapshot(purchasedArgs, {
    after_json: JSON.stringify({
      version: 1,
      recipeId: 2,
      title: "替代菜2",
      validationFingerprint: legalFingerprint,
    }),
  });
  const resPurchased = revalidatePendingSuggestions(sPurchased, 1, cPurchased, "2026-10-21");
  assert.equal(resPurchased.evaluations[0].outcome, "protected");
  assert.ok(resPurchased.evaluations[0].checks.some(c => c.includes("采购")));
  assert.equal(sPurchased.data.meal_plan_changes[0].status, "pending");
  assert.deepEqual({ ...sPurchased.data.meal_plan_items[0], user_id: undefined }, { ...purchasedItemBefore, user_id: undefined });

  // 4. 真正未知字段（即使附带 validationFingerprint）仍被 strict parse 拒绝并记录 needs_review
  const unknownArgs = fixture();
  const unknownItemBefore = structuredClone(unknownArgs.items[0]);
  const { snapshot: sUnknown, compatibility: cUnknown } = makeSnapshot(unknownArgs, {
    after_json: JSON.stringify({
      version: 1,
      recipeId: 2,
      title: "替代菜2",
      validationFingerprint: legalFingerprint,
      completelyUnknownField: "not_allowed",
    }),
  });
  const resUnknown = revalidatePendingSuggestions(sUnknown, 1, cUnknown, "2026-10-21");
  assert.equal(resUnknown.evaluations[0].outcome, "needs_review");
  assert.match(resUnknown.evaluations[0].checks[0], /格式不符合规范/);
  assert.equal(sUnknown.data.meal_plan_changes[0].status, "pending");
  assert.deepEqual({ ...sUnknown.data.meal_plan_items[0], user_id: undefined }, { ...unknownItemBefore, user_id: undefined });
});

test("hasEffectiveMaintenanceEvents: correctly identifies event efficacy", () => {
  assert.equal(hasEffectiveMaintenanceEvents([{ event_type: "daily_check" }], false), false);
  assert.equal(hasEffectiveMaintenanceEvents([{ event_type: "daily_check" }], true), true);
  assert.equal(hasEffectiveMaintenanceEvents([{ event_type: "unknown_future_event" }], true), false);
  assert.equal(hasEffectiveMaintenanceEvents([{ event_type: "inventory_changed" }], false), true);
  assert.equal(hasEffectiveMaintenanceEvents([], true), false);
  assert.equal(hasEffectiveMaintenanceEvents(undefined, true), false);
});
