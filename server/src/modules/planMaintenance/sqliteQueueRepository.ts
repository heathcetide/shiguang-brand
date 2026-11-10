import { maintenanceNotice } from "./notice.js";
import { dispatchDaily } from "./daily.js";
import { inputSnapshot, maintenanceInputTables, maintenanceRecipeIds, maintenanceRuleTables, type MaintenanceInputSnapshot } from "./inputSnapshot.js";
import { maintenanceScope } from "./scope.js";
import type { Row } from "../mealPlans/formatters.js";
import { SqliteMealPlansRepository } from "../mealPlans/sqliteRepository.js";
import { MaintenanceApplyConflict, type MaintenanceDiagnostics, type MaintenanceApplication, type MaintenanceChange } from "./queue.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { batchLimit, leaseDuration, MAINTENANCE_MAX_ATTEMPTS, MAINTENANCE_RULE_VERSION, retryAt, type MaintenanceJob, type MaintenanceQueueRepository } from "./queue.js";

export class SqliteMaintenanceQueueRepository implements MaintenanceQueueRepository {
  private readonly db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  async publishResults(limit?: number) {
    return this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT * FROM plan_maintenance_jobs WHERE status IN ('completed','failed')
        AND COALESCE(json_extract(result_json,'$.notificationRecorded'),0)=0 ORDER BY updated_at,id LIMIT ?`).all(batchLimit(limit)) as Row[];
      for (const row of rows) {
        const notice = maintenanceNotice(row);
        if (notice && !this.db.prepare("SELECT id FROM user_notification_inbox WHERE user_id=? AND group_key=?").get(row.user_id,notice.key)) {
          const notification = this.db.prepare(`INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key)
            VALUES(?,'plan_maintenance',?,?,?,?,?,?)`).run(row.user_id,notice.title,notice.body,notice.action ? "action_required" : "system","normal",notice.action ? "pending" : "info",notice.key);
          this.db.prepare("INSERT INTO notification_events(user_id,notification_id,event_type,metadata_json) VALUES(?,?,'created',?)")
            .run(row.user_id,notification.lastInsertRowid,JSON.stringify({ source: "plan_maintenance",jobId: row.id }));
        }
        this.db.prepare("UPDATE plan_maintenance_jobs SET result_json=json_set(COALESCE(result_json,'{}'),'$.notificationRecorded',1) WHERE id=?").run(row.id);
      }
      return rows.length;
    })();
  }

  async enqueueDaily(now: Date, limit?: number) {
    return this.db.transaction(() => {
      const due = this.db.prepare(`SELECT * FROM plan_maintenance_settings WHERE enabled=1
        AND julianday(next_check_at)<=julianday(?) ORDER BY next_check_at,user_id LIMIT ?`).all(now.toISOString(),batchLimit(limit)) as Row[];
      let inserted = 0;
      for (const row of due) {
        const occurrence = dispatchDaily(now,row);
        if (occurrence.date) inserted += this.db.prepare(`INSERT INTO plan_maintenance_events
          (id,user_id,event_type,source_id,subject_id,created_at) VALUES(?,?,'daily_check',?,?,?)
          ON CONFLICT(user_id,event_type,source_id) DO NOTHING`)
          .run(randomUUID(),row.user_id,occurrence.date,occurrence.date,now.toISOString()).changes;
        this.db.prepare(`UPDATE plan_maintenance_settings SET next_check_at=?,next_local_date=?,version=version+1,updated_at=? WHERE user_id=?`)
          .run(occurrence.next.scheduledAt,occurrence.next.localDate,now.toISOString(),row.user_id);
      }
      return inserted;
    })();
  }

  async enqueueEvents(now: Date, limit?: number) {
    return this.db.transaction(() => {
      const events = this.db.prepare(`SELECT e.id,e.user_id FROM plan_maintenance_events e
        WHERE e.processed_at IS NULL AND julianday(e.created_at)<=julianday(?)
          AND NOT EXISTS(SELECT 1 FROM plan_maintenance_job_events m WHERE m.event_id=e.id)
        ORDER BY e.created_at,e.id LIMIT ?`).all(new Date(now.getTime()-30_000).toISOString(),batchLimit(limit)) as { id: string; user_id: number }[];
      for (const userId of new Set(events.map(event => event.user_id))) {
        const queued = this.db.prepare("SELECT id FROM plan_maintenance_jobs WHERE user_id=? AND status='queued' AND attempts=0 ORDER BY created_at,id LIMIT 1").get(userId) as { id: string } | undefined;
        const id = queued?.id ?? randomUUID();
        if (!queued) this.db.prepare("INSERT INTO plan_maintenance_jobs(id,user_id,rule_version,available_at) VALUES(?,?,?,?)").run(id,userId,MAINTENANCE_RULE_VERSION,now.toISOString());
        for (const event of events.filter(event => event.user_id === userId)) this.db.prepare("INSERT INTO plan_maintenance_job_events(event_id,job_id) VALUES(?,?)").run(event.id,id);
      }
      return events.length;
    })();
  }

  async claim(now: Date, leaseMs?: number): Promise<MaintenanceJob | null> {
    return this.db.transaction(() => {
      // An exhausted crashed attempt must not remain running forever.
      this.db.prepare(`UPDATE plan_maintenance_jobs SET status='failed',last_error='lease expired after final attempt',updated_at=?
        WHERE status='running' AND julianday(lease_expires_at)<=julianday(?) AND attempts>=?`).run(now.toISOString(),now.toISOString(),MAINTENANCE_MAX_ATTEMPTS);
      const row = this.db.prepare(`SELECT j.id,j.user_id,j.attempts FROM plan_maintenance_jobs j
        WHERE j.attempts<? AND ((j.status='queued' AND julianday(j.available_at)<=julianday(?))
          OR (j.status='running' AND julianday(j.lease_expires_at)<=julianday(?)))
          AND NOT EXISTS(SELECT 1 FROM plan_maintenance_jobs other WHERE other.user_id=j.user_id AND other.id<>j.id
            AND other.status='running' AND julianday(other.lease_expires_at)>julianday(?))
        ORDER BY j.created_at,j.id LIMIT 1`).get(MAINTENANCE_MAX_ATTEMPTS,now.toISOString(),now.toISOString(),now.toISOString()) as { id: string; user_id: number; attempts: number } | undefined;
      if (!row) return null;
      const token = randomUUID();
      this.db.prepare("UPDATE plan_maintenance_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_expires_at=?,updated_at=? WHERE id=?")
        .run(token,new Date(now.getTime()+leaseDuration(leaseMs)).toISOString(),now.toISOString(),row.id);
      const members = this.db.prepare("SELECT event_id FROM plan_maintenance_job_events WHERE job_id=? ORDER BY event_id").all(row.id) as { event_id: string }[];
      return { id: row.id,userId: row.user_id,attempt: row.attempts+1,leaseToken: token,eventIds: members.map(row => row.event_id) };
    })();
  }

  async candidateRecipeIds() {
    return (this.db.prepare("SELECT id FROM recipes WHERE status='approved' AND deleted_at IS NULL AND COALESCE(quality_status,'trusted') NOT IN ('needs_review','reference') ORDER BY id").all() as { id: number }[]).map(row => row.id);
  }

  async scope(job: MaintenanceJob, fromDate: string) {
    return this.db.transaction(() => {
      const valid = this.db.prepare(`SELECT 1 FROM plan_maintenance_jobs WHERE id=? AND user_id=? AND lease_token=?
        AND attempts=? AND status='running' AND julianday(lease_expires_at)>julianday('now')`).get(job.id,job.userId,job.leaseToken,job.attempt);
      if (!valid) return null;
      const events = this.db.prepare(`SELECT e.* FROM plan_maintenance_events e JOIN plan_maintenance_job_events m ON m.event_id=e.id
        WHERE m.job_id=? AND e.user_id=? ORDER BY e.id`).all(job.id,job.userId) as Row[];
      return maintenanceScope({ dailyEnabled: Boolean((this.db.prepare("SELECT enabled FROM plan_maintenance_settings WHERE user_id=?").get(job.userId) as Row | undefined)?.enabled),userId: job.userId,fromDate,events,
        inventory: this.db.prepare("SELECT * FROM inventory_items WHERE user_id=? ORDER BY id").all(job.userId) as Row[],
        prepared: this.db.prepare("SELECT * FROM prepared_meals WHERE user_id=? ORDER BY id").all(job.userId) as Row[],
        plans: this.db.prepare("SELECT * FROM meal_plans WHERE user_id=? ORDER BY id").all(job.userId) as Row[],
        items: this.db.prepare("SELECT * FROM meal_plan_items WHERE user_id=? ORDER BY id").all(job.userId) as Row[],
      });
    })();
  }

  private readInputs(userId: number, recipeIds: number[], jobId: string) {
    const data: Record<string,Row[]> = {};
    data.maintenance_events = this.db.prepare(`SELECT e.id,e.user_id,e.event_type,e.subject_id,e.details_json FROM plan_maintenance_events e
      JOIN plan_maintenance_job_events m ON m.event_id=e.id WHERE m.job_id=? AND e.user_id=?`).all(jobId,userId) as Row[];
    for (const table of maintenanceInputTables) data[table] = this.db.prepare(`SELECT * FROM ${table} WHERE user_id=?${table === "meal_plan_changes" ? " AND status='pending' ORDER BY id" : ""}`).all(userId) as Row[];
    for (const table of maintenanceRuleTables) data[table] = this.db.prepare(`SELECT * FROM ${table}${table === "kitchenware_catalog" ? " ORDER BY category,name" : ""}`).all() as Row[];
    data.recipe_recommendation_events = this.db.prepare("SELECT * FROM recipe_recommendation_events WHERE user_id=? AND event_type='skip'").all(userId) as Row[];
    recipeIds = maintenanceRecipeIds(recipeIds,data);
    data.recipes = recipeIds.length ? this.db.prepare(`SELECT * FROM recipes WHERE id IN (${recipeIds.map(() => "?").join(",")})`).all(...recipeIds) as Row[] : [];
    return inputSnapshot(userId,recipeIds,data);
  }

  async inputs(job: MaintenanceJob, recipeIds: number[] = []) {
    return this.db.transaction(() => {
      const valid = this.db.prepare(`SELECT 1 FROM plan_maintenance_jobs WHERE id=? AND user_id=? AND lease_token=?
        AND attempts=? AND status='running' AND julianday(lease_expires_at)>julianday('now')`).get(job.id,job.userId,job.leaseToken,job.attempt);
      return valid ? this.readInputs(job.userId,recipeIds,job.id) : null;
    })();
  }

  async applyChanges(job: MaintenanceJob, changes: MaintenanceChange[], expected: Pick<MaintenanceInputSnapshot,"fingerprint" | "recipeIds">, diagnostics?: MaintenanceDiagnostics): Promise<MaintenanceApplication> {
    try {
      return this.db.transaction(() => {
        const valid = () => Boolean(this.db.prepare(`SELECT 1 FROM plan_maintenance_jobs WHERE id=? AND user_id=?
          AND status='running' AND attempts=? AND lease_token=? AND julianday(lease_expires_at)>julianday('now')`)
          .get(job.id,job.userId,job.attempt,job.leaseToken));
        if (!valid()) throw new MaintenanceApplyConflict("lease_lost");
        if (this.readInputs(job.userId,expected.recipeIds,job.id).fingerprint !== expected.fingerprint) throw new MaintenanceApplyConflict("input_conflict");
        const plans = new SqliteMealPlansRepository(this.db);
        const results: Record<string, unknown>[] = [];
        for (const change of changes) {
          if (change.input.recipeId && !expected.recipeIds.includes(change.input.recipeId)) throw new MaintenanceApplyConflict("input_conflict");
          // Check even when the manual change API could return a prior idempotent proposal.
          const current = this.db.prepare(`SELECT i.version,p.version AS planVersion,p.start_date,p.end_date FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id
            WHERE i.id=? AND i.plan_id=? AND i.user_id=? AND p.user_id=i.user_id AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='active' `)
            .get(change.itemId,change.planId,job.userId) as { version: number; planVersion: number; start_date: string; end_date: string } | undefined;
          if (!current || current.version !== change.input.version || current.planVersion !== change.planVersion
            || (change.input.plannedDate && (change.input.plannedDate<current.start_date || change.input.plannedDate>current.end_date))) throw new MaintenanceApplyConflict("input_conflict");
          const result = plans.updateItemInTransaction(job.userId,change.planId,change.itemId,change.input,"maintenance",change.reason);
          if (result.kind !== "updated") throw new MaintenanceApplyConflict("input_conflict");
          results.push(result.value);
        }
        if (!valid()) throw new MaintenanceApplyConflict("lease_lost");
        const daily = this.db.prepare(`SELECT MAX(e.subject_id) AS date FROM plan_maintenance_events e
          JOIN plan_maintenance_job_events m ON m.event_id=e.id WHERE m.job_id=? AND e.user_id=? AND e.event_type='daily_check'`).get(job.id,job.userId) as { date: string | null };
        if (daily.date) this.db.prepare(`UPDATE plan_maintenance_settings SET last_completed_local_date=?,version=version+1,updated_at=CURRENT_TIMESTAMP
          WHERE user_id=? AND (last_completed_local_date IS NULL OR last_completed_local_date<?)`).run(daily.date,job.userId,daily.date);
        this.db.prepare(`UPDATE plan_maintenance_events SET processed_at=CURRENT_TIMESTAMP WHERE user_id=?
          AND id IN (SELECT event_id FROM plan_maintenance_job_events WHERE job_id=?)`).run(job.userId,job.id);
        this.db.prepare("UPDATE plan_maintenance_jobs SET status='completed',result_json=?,lease_token=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(JSON.stringify({ changes: results, diagnostics: diagnostics ?? null }),job.id);
        return { kind: "completed" as const,changes: results };
      })();
    } catch(error) {
      if (error instanceof MaintenanceApplyConflict) return { kind: error.kind };
      throw error;
    }
  }

  async fail(job: MaintenanceJob, now: Date, error: string) {
    return this.db.prepare(`UPDATE plan_maintenance_jobs SET status=?,available_at=?,last_error=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE id=? AND user_id=? AND status='running' AND lease_token=? AND attempts=? AND julianday(lease_expires_at)>julianday(?)`)
      .run(job.attempt>=MAINTENANCE_MAX_ATTEMPTS ? "failed" : "queued",retryAt(now,job.attempt),error.replace(/[\r\n]+/g," ").slice(0,1000),
        now.toISOString(),job.id,job.userId,job.leaseToken,job.attempt,now.toISOString()).changes === 1;
  }
}
