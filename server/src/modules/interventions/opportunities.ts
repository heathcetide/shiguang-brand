import { createHash } from "node:crypto";
import { interventionPreferencesSchema, type InterventionPreferences } from "@dietdigidose/contracts";
import { dailyCheckOccurrence } from "../planMaintenance/schedule.js";

export type InterventionInventory = { id: number; userId: number; expirationDate: string | null; available: boolean; remaining: number; deleted: boolean };
/** Produced by the existing recommendation engine after its hard constraints, never arbitrary client suggestions. */
export type InterventionRecommendation = { recipeId: number; quality: number; hardConstraintsPassed: boolean; inventoryIds: number[] };
export type InterventionCandidate = {
  sourceKey: string; kind: "expiry_rescue" | "dinner_window"; userId: number;
  startsAt: number; expiresAt: number; dataObservedAt: number; localDate: string;
  inventoryIds: number[]; recipeIds: number[]; recommendationQuality: number;
  title: string; body: string; whyNow: string; expiresLabel: string;
  actions: Array<"plan_recipe" | "view_alternatives" | "mark_consumed" | "mark_discarded" | "snooze" | "not_cooking_today" | "not_helpful">;
};
export type OpportunityInput = {
  userId: number; now: number; dataObservedAt: number; preferences: InterventionPreferences;
  inventory: InterventionInventory[]; recommendations: InterventionRecommendation[];
  cookingInProgress: boolean;
  /** Authoritative plan/opt-out state for the meal date, including tomorrow for a midnight-crossing window. */
  dinnerDays: Array<{ localDate: string; alreadyPlanned: boolean; notCooking: boolean }>;
};
function localDate(now: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA",{ timeZone,year: "numeric",month: "2-digit",day: "2-digit" }).formatToParts(now);
  const field = (name: string) => parts.find(part => part.type === name)!.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
}
function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
}
function addDays(date: string, days: number) { return new Date(Date.parse(date)+days*86_400_000).toISOString().slice(0,10); }
function occurrence(date: string,time: string,timeZone: string) {
  const value = dailyCheckOccurrence(date,{ localTime: time,timeZone });
  return value ? Date.parse(value.scheduledAt) : null;
}
function recommendations(input: OpportunityInput, inventoryIds?: Set<number>) {
  const ordered = input.recommendations.filter(row => Number.isSafeInteger(row.recipeId) && row.recipeId>0 && row.hardConstraintsPassed
    && Number.isFinite(row.quality) && row.quality>=0.7 && row.quality<=1
    && (!inventoryIds || row.inventoryIds.some(id => inventoryIds.has(id))))
    .sort((a,b) => b.quality-a.quality || a.recipeId-b.recipeId);
  return ordered.filter((row,index) => ordered.findIndex(other => other.recipeId === row.recipeId) === index).slice(0,3);
}

/** Generates one stable candidate of each eligible kind per local day; does not authorize a delivery or mutate inventory. */
export function interventionOpportunities(input: OpportunityInput): InterventionCandidate[] {
  if (!Number.isSafeInteger(input.userId) || input.userId<=0 || !Number.isFinite(input.now) || !Number.isFinite(input.dataObservedAt)) throw new Error("Invalid opportunity identity or clock");
  const preferences = interventionPreferencesSchema.parse(input.preferences);
  if (!preferences.enabled) return [];
  const today = localDate(input.now,preferences.time_zone), candidates: InterventionCandidate[] = [];
  const common = { userId: input.userId,localDate: today,dataObservedAt: input.dataObservedAt };
  const source = (kind: string, date = today) => `${kind}:${input.userId}:${date}`;
  if (preferences.expiry_rescue) {
    const deadline = addDays(today,3);
    const eligible = input.inventory.filter(item => item.userId === input.userId && Number.isSafeInteger(item.id) && item.id>0 && !item.deleted && item.available
      && Number.isFinite(item.remaining) && item.remaining>0 && item.expirationDate && validDate(item.expirationDate)
      && item.expirationDate>=today && item.expirationDate<=deadline)
      .sort((a,b) => a.expirationDate!.localeCompare(b.expirationDate!) || a.id-b.id);
    const ids = [...new Set(eligible.map(item => item.id))];
    const recipes = recommendations(input,new Set(ids));
    if (ids.length && recipes.length) {
      const firstExpiry = eligible[0].expirationDate!;
      const startsAt = occurrence(today,"00:00",preferences.time_zone);
      const expiresAt = occurrence(addDays(firstExpiry,1),"00:00",preferences.time_zone);
      if (startsAt !== null && expiresAt !== null && input.now>=startsAt && input.now<expiresAt) candidates.push({ ...common,
        sourceKey: source("expiry_rescue"),kind: "expiry_rescue",startsAt,expiresAt,inventoryIds: ids,recipeIds: recipes.map(row => row.recipeId),recommendationQuality: recipes[0].quality,
        title: "有食材可以优先安排",body: "查看临期食材与可做菜谱，选择今天的处理方案。",
        whyNow: `${ids.length} 项仍可用食材将在三天内到期。`,expiresLabel: `最早到期日：${firstExpiry}（${preferences.time_zone}）`,
        actions: ["plan_recipe","view_alternatives","mark_consumed","mark_discarded","snooze","not_helpful"],
      });
    }
  }
  if (preferences.dinner_window && !input.cookingInProgress) for (const mealDate of [today,addDays(today,1)]) {
    const states = input.dinnerDays.filter(day => day.localDate === mealDate);
    // Missing or conflicting date-scoped evidence cannot assert an empty dinner plan.
    if (states.length !== 1 || states[0].alreadyPlanned || states[0].notCooking) continue;
    const expiresAt = occurrence(mealDate,preferences.dinner_time,preferences.time_zone);
    const recipes = recommendations(input);
    if (expiresAt !== null) {
      const startsAt = expiresAt-preferences.dinner_lead_minutes*60_000;
      if (recipes.length && input.now>=startsAt && input.now<expiresAt) candidates.push({ ...common,
        localDate: mealDate,sourceKey: source("dinner_window",mealDate),kind: "dinner_window",startsAt,expiresAt,inventoryIds: [],recipeIds: recipes.map(row => row.recipeId),recommendationQuality: recipes[0].quality,
        title: "现在可以安排晚餐",body: "已有可执行的菜谱建议，查看并选择今晚的安排。",
        whyNow: "已进入你设置的晚餐决策窗口，该用餐日尚未安排或开始烹饪。",expiresLabel: `${mealDate} ${preferences.dinner_time} 前（${preferences.time_zone}）`,
        actions: ["plan_recipe","view_alternatives","not_cooking_today","not_helpful"],
      });
    }
  }
  return candidates;
}
/** Stable opaque identity for persistence; the readable source key remains separately auditable. */
export function interventionCandidateId(candidate: Pick<InterventionCandidate,"sourceKey"|"userId">) {
  return createHash("sha256").update(JSON.stringify([candidate.userId,candidate.sourceKey])).digest("hex");
}
