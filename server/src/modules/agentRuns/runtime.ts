import type { AgentRunsService } from "./service.js";

let configuredService: AgentRunsService | null = null;

export function configureAgentRunsService(service: AgentRunsService) { configuredService = service; }

export function agentRunsService() {
  if (!configuredService) throw new Error("AGENT_RUNS_SERVICE_NOT_CONFIGURED");
  return configuredService;
}
