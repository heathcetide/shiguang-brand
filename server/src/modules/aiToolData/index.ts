import { AiToolDataService } from "./service.js";
import type { AiToolDataRepository } from "./repository.js";

export function createAiToolDataService(repository: AiToolDataRepository) {
  return new AiToolDataService(repository);
}
