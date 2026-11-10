import { AIConversationsService } from "./service.js";
import type { AIConversationsRepository } from "./repository.js";

export function createAIConversationsService(repository: AIConversationsRepository) {
  return new AIConversationsService(repository);
}
export { AIConversationsService } from "./service.js";
export type { AIConversationsRepository } from "./repository.js";
export type { ChatTurnAudit, LegacyInventoryScanJob } from "./types.js";
