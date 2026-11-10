import { ingredient, parseJson, type Row } from "../mealPlans/formatters.js";
import { createPlanningBudget } from "../recommendations/planningBudget.js";
import { recipeDemands } from "../recommendations/quantities.js";
import { quantityEvidenceStatus } from "../inventory/evidence.js";
import { mealChangeDecision } from "../mealPlans/changePolicy.js";
import type { MaintenanceInputSnapshot } from "./inputSnapshot.js";
import type { MaintenanceScope } from "./scope.js";
import { MAINTENANCE_RULE_VERSION } from "./queue.js";

export type LocalMealAssessment = {
  itemId: string; planId: string; date: string;
  decision: "apply" | "suggest" | "keep";
  status: "covered" | "missing" | "unknown";
  requirements: { foodName: string; required: number; covered: number; missing: number; unit: string; uncertain: boolean }[];
};

/** Recalculate captured commitments only. This function never writes stock or marks meals eaten. */
export function recalculateMaintenanceQuantities(snapshot: MaintenanceInputSnapshot, scope: MaintenanceScope, fromDate: string) {
  const notes = scope.checks.filter(check => check.level === "info").map(check => check.reason);
  const scopeChecks = scope.checks.filter(check => check.level !== "info").map(check => check.reason);
  if (!scope.items.length && !scope.preparedTargets.length) return { ruleVersion: MAINTENANCE_RULE_VERSION,inputFingerprint: snapshot.fingerprint,modelCalls: 0,cost: 0,
    assessments: [] as LocalMealAssessment[],checks: scopeChecks,notes };
  const rows = snapshot.data;
  const plans = new Map((rows.meal_plans ?? []).filter(plan => plan.status === "active" && !plan.deleted_at).map(plan => [String(plan.id),plan]));
  const active = (rows.meal_plan_items ?? []).filter(item => !item.deleted_at && plans.has(String(item.plan_id))
    && String(item.planned_date)>=fromDate && !["completed","skipped"].includes(String(item.status)))
    .sort((a,b) => String(a.planned_date).localeCompare(String(b.planned_date)) || String(a.id).localeCompare(String(b.id)));
  const affected = new Set(scope.items.map(item => item.itemId));
  const decision = (item: Row) => mealChangeDecision(item,
    (rows.cooking_queue_items ?? []).find(queue => queue.id === item.queue_item_id && !queue.deleted_at),
    (rows.shopping_list_items ?? []).filter(purchase => !purchase.deleted_at && String(purchase.client_id ?? "").startsWith(`meal-plan:${item.id}:`)));
  const inventory = (rows.inventory_items ?? []).filter(item => Boolean(item.is_available) && !item.deleted_at).map(item => {
    const evidence = (rows.inventory_change_logs ?? []).filter(log => Number(log.inventory_item_id) === Number(item.id)
      && parseJson<Row>(log.metadata_json,{})?.field_evidence).sort((a,b) => Number(b.id)-Number(a.id))[0];
    return { ...item,quantity_evidence_status: quantityEvidenceStatus(evidence?.metadata_json,item.version) };
  });
  // Fixed commitments have first claim, including proposals whose original arrangement
  // remains in force until accepted. The affected mutable meals then share one ledger.
  const fixed = active.filter(item => !affected.has(String(item.id)) || decision(item) !== "apply");
  const budget = createPlanningBudget(inventory,fixed);
  const assessments: LocalMealAssessment[] = [];
  const checks = [...scopeChecks,...budget.checks];
  for (const item of active.filter(item => affected.has(String(item.id)))) {
    const policy = decision(item);
    const raw = parseJson<unknown>(item.ingredients_json,[]);
    const ingredients = Array.isArray(raw) ? raw.map(ingredient).filter(value => value !== null) : [];
    const demands = recipeDemands(ingredients,1,1);
    if (!demands) {
      assessments.push({ itemId: String(item.id),planId: String(item.plan_id),date: String(item.planned_date),decision: policy,status: "unknown",requirements: [] });
      checks.push(`餐次 ${item.id} 的原料用量无法核算，保留原安排并请求核对`);
      // Unknown quantities may occupy any stock; do not promise that later meals can
      // reuse this ledger. This is the same rule used for unknown fixed commitments.
      budget.markUnknownCommitment();
      continue;
    }
    const preview = policy === "apply" ? budget.consume(demands,String(item.planned_date),String(item.id))
      : budget.commitmentPreviews.get(String(item.id))!;
    const requirements = preview.map((part,index) => ({ foodName: part.food_name,required: demands[index].amount_value,
      covered: part.covered_value,missing: part.missing_value,unit: part.unit,uncertain: part.quantity_status === "unknown" }));
    const status = requirements.some(part => part.uncertain) ? "unknown" : requirements.some(part => part.missing>0.000001) ? "missing" : "covered";
    assessments.push({ itemId: String(item.id),planId: String(item.plan_id),date: String(item.planned_date),decision: policy,status,requirements });
    for (const check of budget.checks) checks.push(check);
  }
  for (const target of scope.preparedTargets) checks.push(`餐次 ${target.targetId} 的待吃分配已变化，需要重新核对份量、期限与复热条件`);
  return { ruleVersion: MAINTENANCE_RULE_VERSION,inputFingerprint: snapshot.fingerprint,modelCalls: 0,cost: 0,
    assessments,checks: [...new Set(checks)],notes };
}
