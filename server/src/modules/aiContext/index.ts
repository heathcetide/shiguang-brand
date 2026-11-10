import type { AiContextRepository } from "./repository.js";
import { AiContextService } from "./service.js";

export function createAiContextService(repository: AiContextRepository) {
  return new AiContextService(repository);
}
