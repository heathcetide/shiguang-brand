import type { AIConversationsService } from "./service.js";

let configuredService: AIConversationsService | null = null;
export function configureAIConversationsService(service: AIConversationsService) { configuredService = service; }
export function aiConversationsService() {
  if (!configuredService) throw new Error("AI_CONVERSATIONS_SERVICE_NOT_CONFIGURED");
  return configuredService;
}
