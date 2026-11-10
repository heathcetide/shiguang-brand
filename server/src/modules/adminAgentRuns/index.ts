import { db } from "../../storage/db.js";
import { getPublicAgentCheckpointState } from "../../services/agent/runtime.js";
import { createAdminAgentRunsRouter as createRouter } from "./route.js";
import { AdminAgentRunsService } from "./service.js";
import { SqliteAdminAgentRunsRepository } from "./sqliteRepository.js";

export function createAdminAgentRunsRouter() {
  return createRouter(new AdminAgentRunsService(new SqliteAdminAgentRunsRepository(db), getPublicAgentCheckpointState));
}
export { AdminAgentRunsService } from "./service.js";
export type { AdminAgentRunsRepository } from "./repository.js";
