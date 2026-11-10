import { maintenanceRunSummary } from "./runSummary.js";
import type Database from "better-sqlite3";
import type { MaintenanceSettings, PlanMaintenanceRepository } from "./repository.js";

export class SqlitePlanMaintenanceRepository implements PlanMaintenanceRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async runs(userId: number) {
    const rows = this.database.prepare("SELECT id,status,attempts,created_at,updated_at,available_at,result_json FROM plan_maintenance_jobs WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 20").all(userId) as Record<string,unknown>[];
    return rows.map(maintenanceRunSummary);
  }

  async settings(userId: number) {
    const row = this.database.prepare(`SELECT enabled,time_zone AS timeZone,local_time AS localTime,
      next_check_at AS nextCheckAt,next_local_date AS nextLocalDate,last_completed_local_date AS lastCompletedLocalDate,version
      FROM plan_maintenance_settings WHERE user_id=?`).get(userId) as MaintenanceSettings | undefined;
    return row ? { ...row, enabled: Boolean(row.enabled) } : null;
  }

  async saveSettings(userId: number, expectedVersion: number, value: MaintenanceSettings) {
    const values = [Number(value.enabled),value.timeZone,value.localTime,value.nextCheckAt,value.nextLocalDate];
    if (expectedVersion === 0) {
      return this.database.prepare(`INSERT INTO plan_maintenance_settings
        (enabled,time_zone,local_time,next_check_at,next_local_date,user_id) VALUES(?,?,?,?,?,?)
        ON CONFLICT(user_id) DO NOTHING`).run(...values,userId).changes === 1;
    }
    return this.database.prepare(`UPDATE plan_maintenance_settings SET enabled=?,time_zone=?,local_time=?,next_check_at=?,
      next_local_date=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND version=?`)
      .run(...values,userId,expectedVersion).changes === 1;
  }
}
