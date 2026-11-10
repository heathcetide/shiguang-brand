import type { AdminAuditRepository } from "./repository.js";
import type { AdminAuditEvent } from "./types.js";

export class AdminAuditService {
  private readonly repository: AdminAuditRepository;
  constructor(repository: AdminAuditRepository) { this.repository = repository; }

  async record(event: AdminAuditEvent) {
    try {
      await this.repository.record(event);
    } catch (error) {
      console.error("[AdminAuditService Error]", error instanceof Error ? error.message : error);
    }
  }
}
