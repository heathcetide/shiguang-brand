import { maintenanceNotice } from "./notice.js";
import { dispatchDaily } from "./daily.js";
import { inputSnapshot, maintenanceInputTables, maintenanceRecipeIds, maintenanceRuleTables, type MaintenanceInputSnapshot } from "./inputSnapshot.js";
import { maintenanceScope } from "./scope.js";
import type { Row } from "../mealPlans/formatters.js";
import { lockMealPlanning } from "../mealPlans/postgresLock.js";
import { PostgresMealPlansRepository } from "../mealPlans/postgresRepository.js";
import { MaintenanceApplyConflict, type MaintenanceDiagnostics, type MaintenanceApplication, type MaintenanceChange } from "./queue.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { batchLimit, leaseDuration, MAINTENANCE_MAX_ATTEMPTS, MAINTENANCE_RULE_VERSION, retryAt, type MaintenanceJob, type MaintenanceQueueRepository } from "./queue.js";

export class PostgresMaintenanceQueueRepository implements MaintenanceQueueRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  private async transaction<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await action(client); await client.query("COMMIT"); return result; }
    catch(error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async publishResults(limit?: number) {
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('plan-maintenance-notices'))");
      const rows = (await client.query(`SELECT * FROM plan_maintenance_jobs WHERE status IN ('completed','failed')
        AND COALESCE(result_json->>'notificationRecorded','0')='0' ORDER BY updated_at,id LIMIT $1 FOR UPDATE SKIP LOCKED`,[batchLimit(limit)])).rows;
      for (const row of rows) {
        const notice = maintenanceNotice(row);
        if (notice && !(await client.query("SELECT id FROM user_notification_inbox WHERE user_id=$1 AND group_key=$2",[row.user_id,notice.key])).rows[0]) {
          const notification = (await client.query(`INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key)
            VALUES($1,'plan_maintenance',$2,$3,$4,'normal',$5,$6) RETURNING id`,[row.user_id,notice.title,notice.body,notice.action ? "action_required" : "system",notice.action ? "pending" : "info",notice.key])).rows[0];
          await client.query("INSERT INTO notification_events(user_id,notification_id,event_type,metadata_json) VALUES($1,$2,'created',$3::jsonb)",
            [row.user_id,notification.id,JSON.stringify({ source: "plan_maintenance",jobId: row.id })]);
        }
        await client.query("UPDATE plan_maintenance_jobs SET result_json=COALESCE(result_json,'{}'::jsonb)||'{\"notificationRecorded\":1}'::jsonb WHERE id=$1",[row.id]);
      }
      return rows.length;
    });
  }

  async enqueueDaily(now: Date, limit?: number) {
    return this.transaction(async client => {
      const due = (await client.query(`SELECT * FROM plan_maintenance_settings WHERE enabled=TRUE
        AND next_check_at<=$1 ORDER BY next_check_at,user_id LIMIT $2 FOR UPDATE SKIP LOCKED`,[now.toISOString(),batchLimit(limit)])).rows;
      let inserted = 0;
      for (const row of due) {
        const occurrence = dispatchDaily(now,row);
        if (occurrence.date) inserted += (await client.query(`INSERT INTO plan_maintenance_events
          (id,user_id,event_type,source_id,subject_id,created_at) VALUES($1,$2,'daily_check',$3,$3,$4)
          ON CONFLICT(user_id,event_type,source_id) DO NOTHING`,[randomUUID(),row.user_id,occurrence.date,now.toISOString()])).rowCount ?? 0;
        await client.query(`UPDATE plan_maintenance_settings SET next_check_at=$1,next_local_date=$2,version=version+1,updated_at=$3 WHERE user_id=$4`,
          [occurrence.next.scheduledAt,occurrence.next.localDate,now.toISOString(),row.user_id]);
      }
      return inserted;
    });
  }

  async enqueueEvents(now: Date, limit?: number) {
    return this.transaction(async client => {
      // Serialize only queue bookkeeping. Business event inserts never take this lock.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('plan-maintenance-queue'))");
      const events = (await client.query(`SELECT e.id,e.user_id FROM plan_maintenance_events e
        WHERE e.processed_at IS NULL AND e.created_at<=$1
          AND NOT EXISTS(SELECT 1 FROM plan_maintenance_job_events m WHERE m.event_id=e.id)
        ORDER BY e.created_at,e.id LIMIT $2`,[new Date(now.getTime()-30_000).toISOString(),batchLimit(limit)])).rows as { id: string; user_id: number }[];
      for (const userId of new Set(events.map(event => event.user_id))) {
        const queued = (await client.query("SELECT id FROM plan_maintenance_jobs WHERE user_id=$1 AND status='queued' AND attempts=0 ORDER BY created_at,id LIMIT 1",[userId])).rows[0];
        const id = queued?.id ?? randomUUID();
        if (!queued) await client.query("INSERT INTO plan_maintenance_jobs(id,user_id,rule_version,available_at) VALUES($1,$2,$3,$4)",[id,userId,MAINTENANCE_RULE_VERSION,now.toISOString()]);
        for (const event of events.filter(event => event.user_id === userId)) await client.query("INSERT INTO plan_maintenance_job_events(event_id,job_id) VALUES($1,$2)",[event.id,id]);
      }
      return events.length;
    });
  }

  async claim(now: Date, leaseMs?: number): Promise<MaintenanceJob | null> {
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('plan-maintenance-queue'))");
      await client.query(`UPDATE plan_maintenance_jobs SET status='failed',last_error='lease expired after final attempt',updated_at=$1
        WHERE status='running' AND lease_expires_at<=$1 AND attempts>=$2`,[now.toISOString(),MAINTENANCE_MAX_ATTEMPTS]);
      const row = (await client.query(`SELECT j.id,j.user_id,j.attempts FROM plan_maintenance_jobs j
        WHERE j.attempts<$1 AND ((j.status='queued' AND j.available_at<=$2) OR (j.status='running' AND j.lease_expires_at<=$2))
          AND NOT EXISTS(SELECT 1 FROM plan_maintenance_jobs other WHERE other.user_id=j.user_id AND other.id<>j.id
            AND other.status='running' AND other.lease_expires_at>$2)
        ORDER BY j.created_at,j.id LIMIT 1`,[MAINTENANCE_MAX_ATTEMPTS,now.toISOString()])).rows[0];
      if (!row) return null;
      const token = randomUUID();
      await client.query("UPDATE plan_maintenance_jobs SET status='running',attempts=attempts+1,lease_token=$1,lease_expires_at=$2,updated_at=$3 WHERE id=$4",
        [token,new Date(now.getTime()+leaseDuration(leaseMs)).toISOString(),now.toISOString(),row.id]);
      const members = (await client.query("SELECT event_id FROM plan_maintenance_job_events WHERE job_id=$1 ORDER BY event_id",[row.id])).rows;
      return { id: row.id,userId: row.user_id,attempt: row.attempts+1,leaseToken: token,eventIds: members.map(row => row.event_id) };
    });
  }

  async candidateRecipeIds() {
    return (await this.pool.query("SELECT id FROM recipes WHERE status='approved' AND deleted_at IS NULL AND COALESCE(quality_status,'trusted') NOT IN ('needs_review','reference') ORDER BY id")).rows.map(row => Number(row.id));
  }

  async scope(job: MaintenanceJob, fromDate: string) {
    return this.transaction(async client => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const valid = (await client.query(`SELECT 1 FROM plan_maintenance_jobs WHERE id=$1 AND user_id=$2 AND lease_token=$3
        AND attempts=$4 AND status='running' AND lease_expires_at>clock_timestamp()`,[job.id,job.userId,job.leaseToken,job.attempt])).rows[0];
      if (!valid) return null;
      const events = (await client.query(`SELECT e.* FROM plan_maintenance_events e JOIN plan_maintenance_job_events m ON m.event_id=e.id
        WHERE m.job_id=$1 AND e.user_id=$2 ORDER BY e.id`,[job.id,job.userId])).rows;
      return maintenanceScope({ dailyEnabled: Boolean((await client.query("SELECT enabled FROM plan_maintenance_settings WHERE user_id=$1",[job.userId])).rows[0]?.enabled),userId: job.userId,fromDate,events,
        inventory: (await client.query("SELECT * FROM inventory_items WHERE user_id=$1 ORDER BY id",[job.userId])).rows,
        prepared: (await client.query("SELECT * FROM prepared_meals WHERE user_id=$1 ORDER BY id",[job.userId])).rows,
        plans: (await client.query("SELECT * FROM meal_plans WHERE user_id=$1 ORDER BY id",[job.userId])).rows,
        items: (await client.query("SELECT * FROM meal_plan_items WHERE user_id=$1 ORDER BY id",[job.userId])).rows,
      });
    });
  }

  private async readInputs(client: PoolClient, userId: number, recipeIds: number[], jobId: string, lock = false) {
    const data: Record<string,Record<string,unknown>[]> = {};
    const suffix = lock ? " FOR UPDATE" : "";
    data.maintenance_events = (await client.query(`SELECT e.id,e.user_id,e.event_type,e.subject_id,e.details_json FROM plan_maintenance_events e
      JOIN plan_maintenance_job_events m ON m.event_id=e.id WHERE m.job_id=$1 AND e.user_id=$2${lock ? " FOR UPDATE OF e" : ""}`,[jobId,userId])).rows;
    for (const table of maintenanceInputTables) data[table] = (await client.query(`SELECT * FROM ${table} WHERE user_id=$1${table === "meal_plan_changes" ? " AND status='pending' ORDER BY id" : ""}${suffix}`,[userId])).rows;
    // Lock these infrequently edited governance tables against inserts as well as
    // updates. Rule changes cannot slip into the validation/application window.
    if (lock) await client.query(`LOCK TABLE ${maintenanceRuleTables.join(",")} IN SHARE MODE`);
    for (const table of maintenanceRuleTables) data[table] = (await client.query(`SELECT * FROM ${table}${table === "kitchenware_catalog" ? " ORDER BY category,name" : ""}`)).rows;
    data.recipe_recommendation_events = (await client.query(`SELECT * FROM recipe_recommendation_events WHERE user_id=$1 AND event_type='skip'${suffix}`,[userId])).rows;
    recipeIds = maintenanceRecipeIds(recipeIds,data as Record<string, Row[]>);
    data.recipes = recipeIds.length ? (await client.query(`SELECT * FROM recipes WHERE id=ANY($1::integer[])${lock ? " FOR SHARE" : ""}`,[recipeIds])).rows : [];
    return inputSnapshot(userId,recipeIds,data);
  }

  async inputs(job: MaintenanceJob, recipeIds: number[] = []) {
    return this.transaction(async client => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const valid = (await client.query(`SELECT 1 FROM plan_maintenance_jobs WHERE id=$1 AND user_id=$2 AND lease_token=$3
        AND attempts=$4 AND status='running' AND lease_expires_at>clock_timestamp()`,[job.id,job.userId,job.leaseToken,job.attempt])).rows[0];
      return valid ? this.readInputs(client,job.userId,recipeIds,job.id) : null;
    });
  }

  async applyChanges(job: MaintenanceJob, changes: MaintenanceChange[], expected: Pick<MaintenanceInputSnapshot,"fingerprint" | "recipeIds">, diagnostics?: MaintenanceDiagnostics): Promise<MaintenanceApplication> {
    try {
      return await this.transaction(async client => {
        await lockMealPlanning(client,job.userId);
        const lease = (await client.query(`SELECT id FROM plan_maintenance_jobs WHERE id=$1 AND user_id=$2
          AND status='running' AND attempts=$3 AND lease_token=$4 AND lease_expires_at>clock_timestamp() FOR UPDATE`,
          [job.id,job.userId,job.attempt,job.leaseToken])).rows[0];
        if (!lease) throw new MaintenanceApplyConflict("lease_lost");
        // The parent FK row blocks new owned inputs; existing input rows are locked
        // below. These locks last only for validation/application, never computation.
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[job.userId]);
        const actual = await this.readInputs(client,job.userId,expected.recipeIds,job.id,true);
        if (actual.fingerprint !== expected.fingerprint) throw new MaintenanceApplyConflict("input_conflict");
        const plans = new PostgresMealPlansRepository(this.pool);
        const results: Record<string, unknown>[] = [];
        for (const change of changes) {
          if (change.input.recipeId && !expected.recipeIds.includes(change.input.recipeId)) throw new MaintenanceApplyConflict("input_conflict");
          const current = (await client.query(`SELECT i.version,p.version AS plan_version,p.start_date,p.end_date FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id
            WHERE i.id=$1 AND i.plan_id=$2 AND i.user_id=$3 AND p.user_id=i.user_id AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='active' FOR UPDATE OF i,p`,
            [change.itemId,change.planId,job.userId])).rows[0];
          if (!current || Number(current.version) !== change.input.version || Number(current.plan_version) !== change.planVersion
            || (change.input.plannedDate && (change.input.plannedDate<current.start_date || change.input.plannedDate>current.end_date))) throw new MaintenanceApplyConflict("input_conflict");
          const result = await plans.updateItemWithClient(client,job.userId,change.planId,change.itemId,change.input,"maintenance",change.reason);
          if (result.kind !== "updated") throw new MaintenanceApplyConflict("input_conflict");
          results.push(result.value);
        }
        const completed = await client.query(`UPDATE plan_maintenance_jobs SET status='completed',result_json=$1::jsonb,lease_token=NULL,
          lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND lease_expires_at>clock_timestamp()`,[JSON.stringify({ changes: results, diagnostics: diagnostics ?? null }),job.id]);
        if (completed.rowCount !== 1) throw new MaintenanceApplyConflict("lease_lost");
        const daily = (await client.query(`SELECT MAX(e.subject_id) AS date FROM plan_maintenance_events e
          JOIN plan_maintenance_job_events m ON m.event_id=e.id WHERE m.job_id=$1 AND e.user_id=$2 AND e.event_type='daily_check'`,[job.id,job.userId])).rows[0];
        if (daily.date) await client.query(`UPDATE plan_maintenance_settings SET last_completed_local_date=$1,version=version+1,updated_at=CURRENT_TIMESTAMP
          WHERE user_id=$2 AND (last_completed_local_date IS NULL OR last_completed_local_date<$1)`,[daily.date,job.userId]);
        await client.query(`UPDATE plan_maintenance_events SET processed_at=CURRENT_TIMESTAMP WHERE user_id=$1
          AND id IN (SELECT event_id FROM plan_maintenance_job_events WHERE job_id=$2)`,[job.userId,job.id]);
        return { kind: "completed",changes: results };
      });
    } catch(error) {
      if (error instanceof MaintenanceApplyConflict) return { kind: error.kind };
      throw error;
    }
  }

  async fail(job: MaintenanceJob, now: Date, error: string) {
    const result = await this.pool.query(`UPDATE plan_maintenance_jobs SET status=$1,available_at=$2,last_error=$3,lease_token=NULL,lease_expires_at=NULL,updated_at=$4
      WHERE id=$5 AND user_id=$6 AND status='running' AND lease_token=$7 AND attempts=$8 AND lease_expires_at>$4`,
      [job.attempt>=MAINTENANCE_MAX_ATTEMPTS ? "failed" : "queued",retryAt(now,job.attempt),error.replace(/[\r\n]+/g," ").slice(0,1000),
        now.toISOString(),job.id,job.userId,job.leaseToken,job.attempt]);
    return result.rowCount === 1;
  }
}
