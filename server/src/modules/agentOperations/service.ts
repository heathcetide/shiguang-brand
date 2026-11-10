import type { AgentOperationsRepository, ExecutableAgentAction } from "./repository.js";

export class AgentOperationsService {
  private readonly repository: AgentOperationsRepository;

  constructor(repository: AgentOperationsRepository) {
    this.repository = repository;
  }

  executeActions(userId: number, runId: string, proposals: ExecutableAgentAction[]) {
    return this.repository.executeActions(userId, runId, proposals);
  }

  undoActions(userId: number, runId: string) {
    return this.repository.undoActions(userId, runId);
  }
}
