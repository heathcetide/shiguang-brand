import type { AIRuntimeService } from "./service.js";

let configuredService: AIRuntimeService | null = null;
export function configureAIRuntimeService(service: AIRuntimeService) { configuredService = service; }
export function aiRuntimeService() {
  if (!configuredService) throw new Error("AI_RUNTIME_SERVICE_NOT_CONFIGURED");
  return configuredService;
}
