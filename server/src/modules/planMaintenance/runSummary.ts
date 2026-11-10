import type { PlanMaintenanceRun } from "@dietdigidose/contracts";
import { parseJson, type Row } from "../mealPlans/formatters.js";
const date = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
/** Expose an account-owned summary, never internal errors, full snapshots or lease tokens. */
export function maintenanceRunSummary(row: Row): PlanMaintenanceRun {
  const result = (parseJson<Row | null>(row.result_json,{}) ?? {});
  const changes = Array.isArray(result.changes) ? result.changes as Row[] : [];
  const count = (status: string) => changes.filter(value => (value?.change as Row | undefined)?.status === status).length;
  const diagnostics = result.diagnostics as Row | undefined;
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks.filter((value): value is string => typeof value === "string") : [];
  const notes = Array.isArray(diagnostics?.notes) ? diagnostics.notes.filter((value): value is string => typeof value === "string") : [];
  const status = row.status as PlanMaintenanceRun["status"];
  const attempts = Number(row.attempts);
  return { id: String(row.id),status,attempts,createdAt: date(row.created_at),updatedAt: date(row.updated_at),
    retryAt: status === "queued" && attempts>0 ? date(row.available_at) : null,
    applied: count("applied"),suggested: count("pending"),kept: count("blocked"),checks,notes,
    message: status === "failed" ? "检查未能完成，已停止自动重试。原安排保留，请查看餐次计划。"
      : status === "queued" ? attempts ? "检查需要重算，正在等待重试。" : "检查已排队。"
      : status === "running" ? "正在核对计划。" : checks.length ? "检查已完成；待核对事项仍需你确认。" : "检查已完成。" };
}
