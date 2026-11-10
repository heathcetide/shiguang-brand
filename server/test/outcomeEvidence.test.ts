import assert from "node:assert/strict";
import { test } from "node:test";
import { formatOutcomeEvidence } from "../src/modules/recommendations/outcomeEvidence.js";
const production = { id: "batch",recipe_id: 7,food_name: "蛋羹",produced_servings: 3,produced_at: "2026-09-12 10:00:00" };
const eating = { id: "eat",recipe_id: 7,food_name: "蛋羹",event_type: "eat",servings: 1,created_at: "2026-09-12 12:00:00",diet_record_id: 3 };
test("production is distinct from consumption and duplicate results remain one fact",() => {
  const facts = formatOutcomeEvidence([production,production],[eating,eating]);
  assert.equal(facts.length,2);
  assert.equal(facts.filter(fact => fact.kind === "eat").length,1);
  assert.equal(facts.find(fact => fact.kind === "production")!.servings,3);
});
test("undo and intake deletion revoke consumption evidence; discard does not infer a reason",() => {
  for (const mode of ["undo_eating","delete_intake"]) {
    const fact = formatOutcomeEvidence([],[{ ...eating,correction_id: "correction",correction_mode: mode,corrected_at: "2026-09-12 13:00:00" }])[0];
    assert.equal(fact.valid,false); assert.equal(fact.correctionId,"correction");
  }
  assert.equal(formatOutcomeEvidence([],[{ ...eating,diet_record_id: null }])[0].valid,false);
  const discard = formatOutcomeEvidence([],[{ ...eating,event_type: "discard",diet_record_id: null }])[0];
  assert.equal(discard.valid,true); assert.match(discard.explanation,/原因未知/);
});

test("confirmed and automatic inventory remain distinct and undo invalidates the original evidence",() => {
  const row = { id: 1,food_name: "番茄",quantity_after: 2,quantity_unit: "piece",created_at: "2026-09-12 10:00:00",metadata_json: { acceptance: "manual" } };
  const manual = formatOutcomeEvidence([],[],[row])[0];
  assert.equal(manual.kind,"inventory"); assert.equal(manual.quantity,2); assert.equal(manual.servings,undefined);
  assert.match(manual.explanation,/用户确认/);
  assert.match(formatOutcomeEvidence([],[],[{ ...row,metadata_json: JSON.stringify({ acceptance: "automatic" }) }])[0].explanation,/自动入库/);
  assert.equal(formatOutcomeEvidence([],[],[{ ...row,undo_id: 2 }])[0].valid,false);
});
test("restoring an applied meal change invalidates change evidence without inferring a taste",() => {
  const change = { id: "change",status: "applied",after_json: { recipeId: 1,title: "新菜" },created_at: "2026-09-12 10:00:00",applied_at: "2026-09-12 11:00:00" };
  assert.equal(formatOutcomeEvidence([],[],[],[change])[0].valid,true);
  const restored = formatOutcomeEvidence([],[],[],[{ ...change,status: "reverted" }])[0];
  assert.equal(restored.valid,false); assert.equal(restored.recipeId,1);
});

test("actual time remains an explicit report and missing history stays unknown",() => {
  assert.match(formatOutcomeEvidence([production],[])[0].explanation,/未采集/);
  assert.match(formatOutcomeEvidence([{ ...production,reported_cooking_minutes: 27 }],[])[0].explanation,/用户报告实际用时 27 分钟/);
});

test("dialogue preference provenance includes only executed persistent changes and detects later corrections",() => {
  const statement = { id: "action",status: "executed",before_json: { servings: 1 },result_json: { scope: "persistent",kitchenPreferences: { servings: 2 } },current_preferences: { servings: 2 },created_at: "2026-09-12 10:00:00" };
  const facts = formatOutcomeEvidence([],[],[],[],[statement,statement]);
  assert.equal(facts.length,1); assert.equal(facts[0].valid,true); assert.match(facts[0].explanation,/常用份量/);
  assert.equal(formatOutcomeEvidence([],[],[],[],[{ ...statement,current_preferences: { servings: 3 } }])[0].valid,false);
  assert.equal(formatOutcomeEvidence([],[],[],[],[{ ...statement,status: "undone" }])[0].valid,false);
  assert.equal(formatOutcomeEvidence([],[],[],[],[{ ...statement,status: "awaiting_approval" }]).length,0);
  assert.equal(formatOutcomeEvidence([],[],[],[],[{ ...statement,result_json: { scope: "request",kitchenPreferences: { servings: 2 } } }]).length,0);
});

test("remaining food is a current observation, not inferred consumption or dislike",() => {
  const current = { ...production,remaining_servings: 2,updated_at: "2026-09-12 12:00:00" };
  const facts = formatOutcomeEvidence([current],[]);
  assert.equal(facts.length,1); assert.equal(facts[0].kind,"production");
  assert.equal(facts[0].servings,3); assert.equal(facts[0].remainingServings,2);
  assert.equal(facts[0].observedAt,"2026-09-12T12:00:00Z");
  assert.equal(formatOutcomeEvidence([{ ...current,remaining_servings: 0 }],[])[0].remainingServings,0);
  assert.equal(formatOutcomeEvidence([{ ...current,remaining_servings: 3 }],[])[0].remainingServings,3);
  assert.equal(formatOutcomeEvidence([production],[])[0].remainingServings,undefined);
});
