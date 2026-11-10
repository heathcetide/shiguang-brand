import { cookingPlanDraftSchema } from "@dietdigidose/contracts";
import { parseJson } from "../mealPlans/formatters.js";
import type { Row } from "../recommendations/types.js";
import type { RecommendationsService } from "../recommendations/service.js";
import type { InterventionRecommendation } from "./opportunities.js";

export function interventionLocalDate(now: number,timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA",{ timeZone,year: "numeric",month: "2-digit",day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type===type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function interventionDates(now: number,timeZone: string) {
  const today = interventionLocalDate(now,timeZone);
  return [today,new Date(Date.parse(today)+86_400_000).toISOString().slice(0,10)];
}
/** Ranking points normalized to the engine's 90-point positive maximum; not a probability. */
export function interventionRecommendations(results: Awaited<ReturnType<RecommendationsService["compute"]>>["results"]): InterventionRecommendation[] {
  return results.filter(row => row.hardConstraints.unmet.length===0 && ["quality","permission","allergy","time","kitchenware"].every(key => row.hardConstraints.satisfied.includes(key))
    && row.features.uncertainIngredients.length===0 && row.features.missingIngredients.length===0 && row.recipe.ingredients.length>0)
    .map(row => ({ recipeId: row.recipeId,quality: Math.max(0,Math.min(1,row.score/90)),hardConstraintsPassed: true,
      inventoryIds: [...new Set(row.features.inventoryEvidence.allocations.filter(item => item.amount>0).map(item => item.itemId))] }));
}

export function interventionDinnerState(dates: string[],timeZone: string,items: Row[],plans: Row[],queue: Row[],notCookingDate: string | null) {
  const active = queue.filter(row => row.deleted_at == null && ["waiting","preparing","ready","cooking"].includes(String(row.status)));
  const cookingInProgress = active.some(row => ["preparing","ready","cooking"].includes(String(row.status)));
  const dinnerDays = dates.map(localDate => {
    let alreadyPlanned = items.some(row => row.planned_date===localDate && ["dinner","晚餐"].includes(String(row.meal_type)) && row.deleted_at==null && row.status!=="cancelled");
    for (const plan of plans) {
      const constraints = parseJson<Row>(plan.constraints_json,{});
      const saved = constraints.savedCookingDraft as { draft?: unknown } | undefined;
      const raw = constraints.currentCookingDraft ?? saved?.draft;
      if (raw==null) continue;
      const parsed = cookingPlanDraftSchema.safeParse(raw);
      // An unreadable active plan cannot establish that dinner is unplanned.
      if (!parsed.success || parsed.data.meals.some(meal => meal.date===localDate && meal.mealType==="dinner")) alreadyPlanned = true;
    }
    alreadyPlanned ||= active.some(row => {
      if (row.planned_at==null || row.planned_at==="") return true;
      const instant = row.planned_at instanceof Date ? row.planned_at.getTime() : Date.parse(String(row.planned_at));
      if (!Number.isFinite(instant)) return true;
      return interventionLocalDate(instant,timeZone)===localDate;
    });
    return { localDate,alreadyPlanned,notCooking: localDate===notCookingDate };
  });
  return { cookingInProgress,dinnerDays };
}
