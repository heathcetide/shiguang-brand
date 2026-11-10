import type { CookingPlanDraft } from "@dietdigidose/contracts";
import type { Row } from "./types.js";
import { RecommendationsError } from "./errors.js";

/** Legacy drafts may omit preserved slots, so cooking dates alone cannot define their week. */
export function weeklyShoppingWindow(draft: CookingPlanDraft, existing: Row[]) {
  if (draft.shoppingWindow) return draft.shoppingWindow;
  const sources = new Set((draft.weeklyShopping ?? []).flatMap(item => item.sources.map(source => source.mealId)));
  const dates = [...draft.meals.map(meal => meal.date),...existing.filter(item => sources.has(String(item.id))).map(item => String(item.planned_date))].sort();
  const startDate = dates[0], endDate = dates[dates.length-1];
  if (startDate && endDate && Date.parse(endDate)-Date.parse(startDate) === 6*86_400_000) return { startDate,endDate };
  throw new RecommendationsError(409,"旧方案的七日采购范围不完整，请重新生成七日预览后换菜；原方案未修改","WEEKLY_WINDOW_UNKNOWN");
}

export function weeklyHistoryStart(draft: CookingPlanDraft) {
  if (draft.shoppingWindow) return draft.shoppingWindow.startDate;
  const first = draft.meals.map(meal => meal.date).sort()[0];
  return new Date(Date.parse(`${first}T00:00:00Z`)-6*86_400_000).toISOString().slice(0,10);
}
