import type { AgentOperationsService } from "./service.js";

let service: AgentOperationsService | undefined;

export function configureAgentOperationsService(next: AgentOperationsService) {
  service = next;
}

export function agentOperationsService() {
  if (!service) throw new Error("Agent operations service is not configured");
  return service;
}
