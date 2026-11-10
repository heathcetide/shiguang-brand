import { AIWriteConfirmationsService } from "./service.js";
import type { AIWriteConfirmationsRepository } from "./repository.js";

export function createAIWriteConfirmationsService(repository: AIWriteConfirmationsRepository) {
  return new AIWriteConfirmationsService(repository);
}
export { AIWriteConfirmationsService } from "./service.js";
export type { AIWriteConfirmationsRepository } from "./repository.js";
export type { AIWriteAction } from "./types.js";
