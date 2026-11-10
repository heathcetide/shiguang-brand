import type { AIWriteConfirmationsService } from "./service.js";

let configuredService: AIWriteConfirmationsService | null = null;
export function configureAIWriteConfirmationsService(service: AIWriteConfirmationsService) { configuredService = service; }
export function aiWriteConfirmationsService() {
  if (!configuredService) throw new Error("AI_WRITE_CONFIRMATIONS_SERVICE_NOT_CONFIGURED");
  return configuredService;
}
