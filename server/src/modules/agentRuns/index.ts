import type { AgentRunsRepository } from "./repository.js";
import { AgentRunsService } from "./service.js";

export type * from "./repository.js";
export { AgentRunsService } from "./service.js";
export { agentRunsService, configureAgentRunsService } from "./runtime.js";

export function createAgentRunsService(repository: AgentRunsRepository) {
  return new AgentRunsService(repository);
}
