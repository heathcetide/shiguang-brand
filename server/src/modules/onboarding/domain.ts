import { createHash } from "node:crypto";
import { cookingPlanDraftSchema, type OnboardingCompletion, type OnboardingState, type OnboardingUpdate } from "@dietdigidose/contracts";

export type Baseline = { afterId?: number; profileVersion?: number; planVersions?: Record<string, number> };
export type OnboardingRecord = {
  state: OnboardingState;
  baseline: Baseline;
  lastRequestKey: string | null;
  lastRequestFingerprint: string | null;
};
export type OnboardingEvent = "onboarding_started" | "onboarding_completed" | "onboarding_resumed" | "onboarding_save_failed";
export class OnboardingError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) { super(message); this.statusCode = statusCode; this.code = code; }
}
export const conflict = () => new OnboardingError(409, "ONBOARDING_VERSION_CONFLICT", "进度已在另一处更新，请刷新后继续");
export const invalidCompletion = () => new OnboardingError(422, "ONBOARDING_TASK_NOT_COMPLETED", "请先成功保存本次任务，再完成引导");
export function fingerprint(input: OnboardingUpdate) {
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
}
function json(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
const date = (value: unknown) => value instanceof Date ? value.toISOString() : value == null ? null : String(value);
export function recordFromRow(row: Record<string, unknown>): OnboardingRecord {
  const task = row.selected_task as OnboardingState["selectedTask"];
  return {
    state: {
      version: Number(row.version), selectedTask: task, status: row.status as OnboardingState["status"],
      step: row.step as OnboardingState["step"], dismissed: Boolean(Number(row.dismissed)),
      startedAt: date(row.started_at), completedAt: date(row.completed_at), updatedAt: date(row.updated_at),
      completion: task && row.completion_resource_id != null ? { task, resourceId: String(row.completion_resource_id) } : null,
    },
    baseline: json(row.baseline_json) as Baseline,
    lastRequestKey: row.last_request_key == null ? null : String(row.last_request_key),
    lastRequestFingerprint: row.last_request_fingerprint == null ? null : String(row.last_request_fingerprint),
  };
}
export function validPlan(row: Record<string, unknown>) {
  if (row.deleted_at || row.status === "cancelled") return false;
  if (row.status !== "draft") return Number(row.item_count) > 0;
  const constraints = json(row.constraints_json);
  const saved = json(constraints.savedCookingDraft);
  const parsed = cookingPlanDraftSchema.safeParse(constraints.currentCookingDraft ?? saved.draft);
  return parsed.success && parsed.data.unresolved.length === 0 && parsed.data.meals.some(meal => meal.preparedServings > 0 || parsed.data.cooking.some(item => item.targetMealId === meal.id));
}
export function completionMatches(found: OnboardingCompletion | null, requested?: OnboardingCompletion) {
  return found && (!requested || requested.task === found.task && requested.resourceId === found.resourceId) ? found : null;
}
export function confirmedNutrition(row: Record<string, unknown>, baseline: Baseline) {
  const targets = json(row.nutrition_targets_json);
  return row.nutrition_target_source === "user"
    && Number(row.nutrition_target_version) > (baseline.profileVersion ?? 0)
    && Object.values(targets).some(value => typeof value === "number" && Number.isFinite(value) && value > 0);
}
