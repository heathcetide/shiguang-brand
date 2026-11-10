import type { AgentActionProposal, AgentInput, AgentRunStatus, SpecialistName } from "../../services/agent/types.js";
import type { AgentRunsRepository, AgentRunStatusFields } from "./repository.js";

export class AgentRunsService {
  private readonly repository: AgentRunsRepository;
  constructor(repository: AgentRunsRepository) { this.repository = repository; }

  createRun(userId: number, input: AgentInput) { return this.repository.createRun(userId, input); }
  media(runId: string, userId: number) { return this.repository.media(runId, userId); }
  run(runId: string, userId?: number) { return this.repository.run(runId, userId); }
  reusableRun(userId: number, idempotencyKey: string, maxAgeMinutes = 15) {
    return this.repository.reusableRun(userId, idempotencyKey, Math.max(1, Math.min(maxAgeMinutes, 60)));
  }
  setStatus(runId: string, status: AgentRunStatus, fields: AgentRunStatusFields = {}) {
    return this.repository.setStatus(runId, status, fields);
  }
  appendEvent(runId: string, userId: number, agentName: SpecialistName, eventType: string,
    summary: string, payload?: unknown) {
    return this.repository.appendEvent(runId, userId, agentName, eventType, summary.slice(0, 500), payload);
  }
  events(runId: string, userId: number, afterSequence = 0) {
    return this.repository.events(runId, userId, Math.max(0, Math.trunc(afterSequence)));
  }
  saveActions(runId: string, userId: number, proposals: AgentActionProposal[]) {
    return this.repository.saveActions(runId, userId, proposals);
  }
  updateActionStatus(actionId: string, status: string, fields: { before?: unknown; result?: unknown } = {}) {
    return this.repository.updateActionStatus(actionId, status, fields);
  }
  recordActionDecision(actionIds: string[], userId: number, decision: "approve" | "reject" | "edit") {
    return this.repository.recordActionDecision([...new Set(actionIds)], userId, decision);
  }
  actions(runId: string, userId: number) { return this.repository.actions(runId, userId); }
  reviseActions(runId: string, userId: number, actions: Array<AgentActionProposal & { id?: string }>) {
    return this.repository.reviseActions(runId, userId, actions);
  }
  recoverableRuns() { return this.repository.recoverableRuns(); }
  deleteUserData(userId: number) { return this.repository.deleteUserData(userId); }
}
