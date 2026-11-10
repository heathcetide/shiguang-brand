import type { AgentSchedulingRepository } from "./repository.js";

export class AgentSchedulingService {
  private readonly repository: AgentSchedulingRepository;

  constructor(repository: AgentSchedulingRepository) { this.repository = repository; }

  claimQueuedRuns(userId: number, maxRunning = 2) {
    const capacity = Math.min(20, Math.max(1, Math.trunc(maxRunning) || 2));
    return this.repository.claimQueuedRuns(userId, capacity);
  }

  expireAwaitingApproval(runId: string, userId: number) {
    return this.repository.expireAwaitingApproval(runId, userId);
  }

  resetInterruptedRuns() { return this.repository.resetInterruptedRuns(); }
}
