import { db } from "../../storage/db.js";
import { createAdminCommunityRouter as createRouter } from "./route.js";
import { AdminCommunityService } from "./service.js";
import { SqliteAdminCommunityRepository } from "./sqliteRepository.js";

export function createAdminCommunityRouter() {
  return createRouter(new AdminCommunityService(new SqliteAdminCommunityRepository(db)));
}
