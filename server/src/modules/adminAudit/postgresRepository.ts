import type { Pool } from "pg";
import type { AdminAuditRepository } from "./repository.js";
import type { AdminAuditEvent } from "./types.js";

export class PostgresAdminAuditRepository implements AdminAuditRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async record(event: AdminAuditEvent) {
    await this.pool.query(`INSERT INTO admin_audit_logs
      (admin_user_id, action, resource_type, resource_id, summary, details_json, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`, [event.adminUserId, event.action, event.resourceType,
      event.resourceId === undefined || event.resourceId === null ? null : String(event.resourceId), event.summary,
      event.details ? JSON.stringify(event.details) : null, event.ipAddress || null, event.userAgent || null]);
  }
}
