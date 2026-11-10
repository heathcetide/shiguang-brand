import type { AgentSchedulingRepository } from "./repository.js";
import { AgentSchedulingService } from "./service.js";

export function createAgentSchedulingService(repository: AgentSchedulingRepository) {
  return new AgentSchedulingService(repository);
}

export { AgentSchedulingService } from "./service.js";
export type { AgentSchedulingRepository } from "./repository.js";
