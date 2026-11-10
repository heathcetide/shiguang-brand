import type Database from "better-sqlite3";
import type { AdminAuditRepository } from "./repository.js";
import type { AdminAuditEvent } from "./types.js";

export class SqliteAdminAuditRepository implements AdminAuditRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async record(event: AdminAuditEvent) {
    this.database.prepare(`INSERT INTO admin_audit_logs
      (admin_user_id, action, resource_type, resource_id, summary, details_json, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(event.adminUserId, event.action, event.resourceType,
      event.resourceId === undefined || event.resourceId === null ? null : String(event.resourceId), event.summary,
      event.details ? JSON.stringify(event.details) : null, event.ipAddress || null, event.userAgent || null);
  }
}
