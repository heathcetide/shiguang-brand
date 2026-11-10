import type { AIRuntimeRepository } from "./repository.js";
import { AIRuntimeService } from "./service.js";

export function createAIRuntimeService(repository: AIRuntimeRepository) { return new AIRuntimeService(repository); }
