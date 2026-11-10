import type { AgentSchedulingService } from "./service.js";

let configuredService: AgentSchedulingService | null = null;

export function configureAgentSchedulingService(service: AgentSchedulingService) { configuredService = service; }

export function agentSchedulingService() {
  if (!configuredService) throw new Error("AGENT_SCHEDULING_SERVICE_NOT_CONFIGURED");
  return configuredService;
}
