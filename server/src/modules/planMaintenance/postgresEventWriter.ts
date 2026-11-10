import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { MaintenanceEvent } from "./events.js";

/** Uses the caller's transaction connection. Never open a second connection for the outbox. */
export async function appendPostgresMaintenanceEvent(client: PoolClient, event: MaintenanceEvent) {
  await client.query(`INSERT INTO plan_maintenance_events(id,user_id,event_type,source_id,subject_id,details_json)
    VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(user_id,event_type,source_id) DO NOTHING`,
    [randomUUID(),event.userId,event.kind,event.sourceId,event.subjectId,JSON.stringify(event.details ?? {})]);
}
