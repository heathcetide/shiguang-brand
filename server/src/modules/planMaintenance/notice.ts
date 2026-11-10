import { createHash } from "node:crypto";
import { maintenanceRunSummary } from "./runSummary.js";
import { parseJson, type Row } from "../mealPlans/formatters.js";
export function maintenanceNotice(row: Row) {
  const summary = maintenanceRunSummary(row);
  if (summary.status === "failed") return { key: `maintenance:${row.id}`,title: "计划检查未完成",body: "自动重试已结束，原安排保留。请打开检查结果核对。",action: true };
  // Small successful adjustments belong in the change log; only decisions need a reminder.
  if (summary.status !== "completed" || !(summary.suggested || summary.kept || summary.checks.length)) return null;
  const result = parseJson<Row | null>(row.result_json,{}) ?? {};
  const decisions = (Array.isArray(result.changes) ? result.changes as Row[] : []).map(value => value?.change as Row | undefined)
    .filter(value => value && ["pending","blocked"].includes(String(value.status))).map(value => String(value!.id)).sort();
  const key = createHash("sha256").update(JSON.stringify({ checks: [...new Set(summary.checks)].sort(),decisions })).digest("hex");
  return { key: `maintenance-action:${key}`,title: "计划检查需要你确认",body: `提出建议 ${summary.suggested} 项，待核对 ${summary.checks.length} 项。打开查看检查结果。`,action: true };
}
