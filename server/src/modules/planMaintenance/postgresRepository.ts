import { maintenanceRunSummary } from "./runSummary.js";
import type { Pool } from "pg";
import type { MaintenanceSettings, PlanMaintenanceRepository } from "./repository.js";

export class PostgresPlanMaintenanceRepository implements PlanMaintenanceRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async runs(userId: number) {
    const result = await this.pool.query("SELECT id,status,attempts,created_at,updated_at,available_at,result_json FROM plan_maintenance_jobs WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20",[userId]);
    return result.rows.map(maintenanceRunSummary);
  }

  async settings(userId: number) {
    const result = await this.pool.query(`SELECT enabled,time_zone AS "timeZone",local_time AS "localTime",
      next_check_at AS "nextCheckAt",next_local_date AS "nextLocalDate",last_completed_local_date AS "lastCompletedLocalDate",version
      FROM plan_maintenance_settings WHERE user_id=$1`,[userId]);
    const row = result.rows[0];
    if (!row) return null;
    return { ...row, nextCheckAt: row.nextCheckAt instanceof Date ? row.nextCheckAt.toISOString() : row.nextCheckAt } as MaintenanceSettings;
  }

  async saveSettings(userId: number, expectedVersion: number, value: MaintenanceSettings) {
    const values = [value.enabled,value.timeZone,value.localTime,value.nextCheckAt,value.nextLocalDate,userId];
    if (expectedVersion === 0) {
      const result = await this.pool.query(`INSERT INTO plan_maintenance_settings
        (enabled,time_zone,local_time,next_check_at,next_local_date,user_id) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(user_id) DO NOTHING`,values);
      return result.rowCount === 1;
    }
    const result = await this.pool.query(`UPDATE plan_maintenance_settings SET enabled=$1,time_zone=$2,local_time=$3,next_check_at=$4,
      next_local_date=$5,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$6 AND version=$7`,[...values,expectedVersion]);
    return result.rowCount === 1;
  }
}
