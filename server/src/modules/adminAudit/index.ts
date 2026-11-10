import type { AdminAuditRepository } from "./repository.js";
import { AdminAuditService } from "./service.js";

export function createAdminAuditService(repository: AdminAuditRepository) {
  return new AdminAuditService(repository);
}
