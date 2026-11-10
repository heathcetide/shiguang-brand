import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { MaintenanceEvent } from "./events.js";

/** Must join the caller's business transaction so a rollback also removes the event. */
export function appendSqliteMaintenanceEvent(database: Database.Database, event: MaintenanceEvent) {
  if (!database.inTransaction) throw new Error("Maintenance events require a business transaction");
  database.prepare(`INSERT INTO plan_maintenance_events(id,user_id,event_type,source_id,subject_id,details_json)
    VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,event_type,source_id) DO NOTHING`)
    .run(randomUUID(),event.userId,event.kind,event.sourceId,event.subjectId,JSON.stringify(event.details ?? {}));
}
