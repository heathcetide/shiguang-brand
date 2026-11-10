import type { AiContextService } from "./service.js";

let configuredService: AiContextService | null = null;

export function configureAiContextService(service: AiContextService) { configuredService = service; }

export function aiContextService() {
  if (!configuredService) throw new Error("AI_CONTEXT_SERVICE_NOT_CONFIGURED");
  return configuredService;
}
