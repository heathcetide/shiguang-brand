import { parseJson, type Row } from "../mealPlans/formatters.js";
import type { MaintenanceInputSnapshot } from "./inputSnapshot.js";
import type { LocalMealAssessment } from "./recalculate.js";
import type { MaintenanceChange } from "./queue.js";

/** Describe the captured facts, so later edits cannot rewrite the meaning of a past result. */
export function maintenanceExplanations(userId: number, snapshot: MaintenanceInputSnapshot, assessments: LocalMealAssessment[], changes: MaintenanceChange[], checks: string[]) {
  const labels = new Map<string,string>();
  const owned = (row: Row) => Number(row.user_id) === userId;
  const plans = snapshot.data.meal_plans.filter(owned);
  const planIds = new Set(plans.map(row => String(row.id)));
  const mealNames: Record<string,string> = { breakfast: "早餐",lunch: "午餐",dinner: "晚餐",snack: "加餐" };
  const units: Record<string,string> = { g: "克",kg: "千克",ml: "毫升",l: "升",piece: "个",serving: "份",bag: "袋",box: "盒",bottle: "瓶",can: "罐" };
  const label = (date: unknown,meal: unknown,title: unknown) => `${String(date ?? "日期待核对")} ${mealNames[String(meal)] ?? String(meal ?? "餐别待核对")}${title ? `「${String(title)}」` : ""}`;
  for (const item of snapshot.data.meal_plan_items.filter(row => owned(row) && planIds.has(String(row.plan_id)))) {
    const recipe = snapshot.data.recipes.find(row => Number(row.id) === Number(item.recipe_id));
    labels.set(String(item.id),label(item.planned_date,item.meal_type,item.title || recipe?.title));
  }
  for (const plan of plans) {
    const constraints = parseJson<Row | null>(plan.constraints_json,{}) ?? {};
    const saved = parseJson<Row | null>(constraints.savedCookingDraft,{}) ?? {};
    const draft = parseJson<Row | null>(constraints.currentCookingDraft ?? saved.draft,{}) ?? {};
    for (const target of (Array.isArray(draft.meals) ? draft.meals : []) as Row[]) {
      if (target?.id && !labels.has(String(target.id))) labels.set(String(target.id),label(target.date,target.mealType ?? target.meal_type,target.title));
    }
  }
  // Replace only the identifier token, once; user titles are never parsed as templates.
  const readable = (text: string) => text.replace(/餐次 ([^\s]+?)(?= 的| 份量| 数量| 缺少| 暂无|的|$)/g,(_match,id: string) => labels.get(id) ?? "相关餐次");
  const results = checks.map(readable);
  for (const assessment of assessments) {
    if (assessment.decision === "keep" || assessment.status === "covered") continue;
    if (assessment.decision === "apply" && changes.some(change => change.itemId === assessment.itemId)) continue;
    const meal = labels.get(assessment.itemId);
    if (!meal) continue;
    const missing = assessment.requirements.filter(part => !part.uncertain && part.missing>0.000001)
      .map(part => `${part.foodName}缺 ${Number(part.missing.toFixed(6))}${units[part.unit] ?? part.unit}`);
    if (missing.length) results.push(`${meal}：原安排${missing.join("、")}，需补充原料或确认替换`);
    if (assessment.requirements.some(part => part.uncertain)) results.push(`${meal}：库存数量或规格待核对，尚不能确定可覆盖份量`);
  }
  return [...new Set(results)];
}
