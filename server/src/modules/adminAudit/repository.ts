import type { AdminAuditEvent } from "./types.js";

export interface AdminAuditRepository {
  record(event: AdminAuditEvent): Promise<void>;
}
