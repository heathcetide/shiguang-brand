import { nextDailyCheck } from "./schedule.js";
import type { Row } from "../mealPlans/formatters.js";

/** Coalesce downtime into today's occurrence and advance dispatch independently of completion. */
export function dispatchDaily(now: Date, row: Row) {
  const schedule = { timeZone: String(row.time_zone),localTime: String(row.local_time) };
  const due = nextDailyCheck(now,schedule,row.last_completed_local_date as string | null);
  const date = Date.parse(due.scheduledAt) <= now.getTime() ? due.localDate : null;
  return { date,next: date ? nextDailyCheck(now,schedule,date) : due };
}
