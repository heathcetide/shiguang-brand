import { dailyCheckOccurrence } from "../planMaintenance/schedule.js";
/** Only a projection of persisted business facts belongs here, never client events. */
export const CORE_LOOP_METRIC_VERSION = "weekly-core-loop-v1";
export const CORE_LOOP_TIME_ZONE = "Asia/Shanghai";
const DAY = 86_400_000;

export type CoreLoopFact = {
  productionId: string;
  actorKey: string;
  producerKey: string;
  actorClass: "real" | "demo" | "test" | "automation" | "unknown";
  environment: string;
  scope: "personal" | "household";
  householdKey?: string;
  producedAt: string;
  recipeId: number | null;
  selection: null | { requestId: string; recipeId: number; selectedAt: string; matchedItemIds: number[] | null };
  stock: Array<{ itemId: number; confirmedAt: string; confirmed: boolean; scope: "personal" | "household"; ownerKey: string }>;
  deductions: Array<{ itemId: number; before: number | null; after: number | null; amount: number | null; verified: boolean }>;
  intake: Array<{ recordId: string; actorKey: string; servings: number; committedAt: string; survivesCorrection: boolean }>;
};
export type CoreLoopReason = "included" | "environment_unknown" | "non_target_environment" | "excluded_actor" | "actor_unclassified"
  | "not_producer" | "selection_missing" | "selection_mismatch" | "stock_evidence_missing"
  | "no_inventory_match" | "deduction_evidence_missing" | "no_verified_deduction" | "no_surviving_intake" | "invalid_time";
export type CoreLoopEvaluation = { productionId: string; actorKey: string; reason: CoreLoopReason; completedAt: string | null };

function timestamp(value: string): number {
  // DB adapters normalize SQLite UTC timestamps before calling this function.
  // SQLite stores commit times to seconds; compare both adapters at that precision.
  return /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Math.floor(Date.parse(value) / 1000) * 1000 : NaN;
}

export function coreLoopWeek(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("统计日期必须为 YYYY-MM-DD");
  const day = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0,10) !== date) throw new Error("统计日期无效");
  const monday = day - ((new Date(day).getUTCDay() + 6) % 7) * DAY;
  const startDate = new Date(monday).toISOString().slice(0,10), endDate = new Date(monday + 7 * DAY).toISOString().slice(0,10);
  const schedule = { timeZone: CORE_LOOP_TIME_ZONE, localTime: "00:00" };
  const start = dailyCheckOccurrence(startDate, schedule), end = dailyCheckOccurrence(endDate, schedule);
  if (!start || !end) throw new Error("统计周边界无效");
  return { startDate, endDate, start: start.scheduledAt, end: end.scheduledAt };
}

export function evaluateCoreLoop(fact: CoreLoopFact, targetEnvironment: string): CoreLoopEvaluation {
  const result = (reason: CoreLoopReason, completedAt: string | null = null) => ({ productionId: fact.productionId, actorKey: fact.actorKey, reason, completedAt });
  if (["demo","test","automation"].includes(fact.actorClass)) return result("excluded_actor");
  if (!fact.environment || fact.environment === "unknown") return result("environment_unknown");
  if (!targetEnvironment || fact.environment !== targetEnvironment) return result("non_target_environment");
  if (!fact.actorKey || !fact.productionId || fact.actorClass === "unknown") return result("actor_unclassified");
  if (fact.actorClass !== "real") return result("excluded_actor");
  // Shared stock never credits every household member; the cook must also eat.
  if (fact.actorKey !== fact.producerKey) return result("not_producer");
  const selection = fact.selection;
  if (!selection) return result("selection_missing");
  if (!selection.requestId || selection.recipeId !== fact.recipeId) return result("selection_mismatch");
  const produced = timestamp(fact.producedAt), selected = timestamp(selection.selectedAt);
  if (!Number.isFinite(produced) || !Number.isFinite(selected) || selected > produced) return result("invalid_time");
  if (selection.matchedItemIds === null) return result("stock_evidence_missing");
  if (!selection.matchedItemIds.length) return result("no_inventory_match");
  const matched = new Set(selection.matchedItemIds);
  const confirmed = new Set(fact.stock.filter(stock => stock.confirmed && stock.scope === fact.scope
    && (fact.scope === "household" ? Boolean(fact.householdKey) && stock.ownerKey === fact.householdKey : stock.ownerKey === fact.actorKey)
    && Number.isFinite(timestamp(stock.confirmedAt)) && timestamp(stock.confirmedAt) <= selected
    && matched.has(stock.itemId)).map(stock => stock.itemId));
  if (!confirmed.size) return result("stock_evidence_missing");
  const deducted = fact.deductions.some(item => item.verified && confirmed.has(item.itemId)
    && item.before !== null && item.after !== null && item.amount !== null
    && Number.isFinite(item.before) && Number.isFinite(item.after) && Number.isFinite(item.amount)
    && item.after >= 0 && item.amount > 0 && item.before > item.after
    && Math.abs(item.before - item.after - item.amount) < 0.000001);
  if (!deducted) return result(fact.deductions.some(item => matched.has(item.itemId)
    && (!item.verified || item.before === null || item.after === null || item.amount === null || !Number.isFinite(item.before) || !Number.isFinite(item.after) || !Number.isFinite(item.amount))) ? "deduction_evidence_missing" : "no_verified_deduction");
  if (fact.intake.some(item => item.survivesCorrection && item.actorKey === fact.actorKey && item.servings > 0
    && (!item.recordId || !Number.isFinite(timestamp(item.committedAt))))) return result("invalid_time");
  const intake = fact.intake.filter(item => item.survivesCorrection && item.actorKey === fact.actorKey
    && item.recordId && Number.isFinite(item.servings) && item.servings > 0
    && Number.isFinite(timestamp(item.committedAt)) && timestamp(item.committedAt) >= produced)
    .sort((a,b) => timestamp(a.committedAt) - timestamp(b.committedAt) || a.recordId.localeCompare(b.recordId));
  if (!intake.length) return result("no_surviving_intake");
  return result("included", new Date(timestamp(intake[0].committedAt)).toISOString());
}

export function summarizeCoreLoopWeek(facts: CoreLoopFact[], input: { date: string; targetEnvironment: string; coverageStart: string | null; now: string }) {
  const week = coreLoopWeek(input.date);
  const now = timestamp(input.now), start = timestamp(week.start), end = timestamp(week.end);
  if (!Number.isFinite(now)) throw new Error("统计时钟无效");
  const coverage = input.coverageStart ? timestamp(input.coverageStart) : NaN;
  let status = !input.targetEnvironment || !Number.isFinite(coverage) || coverage >= end || now < start ? "not_collected"
    : coverage > start ? "partial" : now < end ? "in_progress" : "complete";
  const evaluations = facts.map(fact => evaluateCoreLoop(fact, input.targetEnvironment));
  const unknownReasons = new Set<CoreLoopReason>(["environment_unknown", "actor_unclassified", "selection_missing", "stock_evidence_missing", "deduction_evidence_missing", "invalid_time"]);
  const unknown = evaluations.filter((evaluation,index) => unknownReasons.has(evaluation.reason) && facts[index].intake.some(item =>
    item.survivesCorrection && item.actorKey === facts[index].actorKey && item.servings > 0
    && (!Number.isFinite(timestamp(item.committedAt)) || (timestamp(item.committedAt) >= start && timestamp(item.committedAt) < end && timestamp(item.committedAt) <= now)))).length;
  if (status !== "not_collected" && unknown > 0) status = "partial";
  const valid = evaluations.filter(item => item.completedAt && timestamp(item.completedAt) >= start && timestamp(item.completedAt) < end && timestamp(item.completedAt) <= now);
  const loops = new Map(valid.map(item => [`${item.actorKey}:${item.productionId}`, item]));
  const users = new Set([...loops.values()].map(item => item.actorKey));
  return { version: CORE_LOOP_METRIC_VERSION, timeZone: CORE_LOOP_TIME_ZONE, ...week, coverageStart: input.coverageStart,
    status, users: ["not_collected", "partial"].includes(status) ? null : users.size, loops: ["not_collected", "partial"].includes(status) ? null : loops.size,
    verifiedUsers: users.size, verifiedLoops: loops.size, unknown,
    smallSample: status !== "not_collected" && users.size > 0 && users.size < 30,
    // Kept separate: a rejected production may not have a knowable completion week.
    evaluations };
}
