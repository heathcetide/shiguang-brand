import type { AuthRequest } from "../../middleware/auth.js";
import type { AdminAuditService } from "../../modules/adminAudit/service.js";

export type AdminAuditEvent = {
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  summary: string;
  details?: Record<string, unknown>;
};

let configuredAdminAuditService: AdminAuditService | undefined;

export function configureAdminAuditService(service: AdminAuditService) { configuredAdminAuditService = service; }

export async function auditAdminAction(req: AuthRequest, event: AdminAuditEvent) {
  if (!req.userId) return;
  if (!configuredAdminAuditService) throw new Error("Admin audit service has not been configured");
  await configuredAdminAuditService.record({
    adminUserId: req.userId,
    ...event,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}
