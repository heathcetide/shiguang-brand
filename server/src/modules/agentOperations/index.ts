export type { AgentActionExecution, AgentOperationsRepository, ExecutableAgentAction } from "./repository.js";
export { AgentOperationsService } from "./service.js";
export { configureAgentOperationsService, agentOperationsService } from "./runtime.js";

import type { AgentOperationsRepository } from "./repository.js";
import { AgentOperationsService } from "./service.js";

export function createAgentOperationsService(repository: AgentOperationsRepository) {
  return new AgentOperationsService(repository);
}
