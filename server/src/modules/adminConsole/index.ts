import { db } from "../../storage/db.js";
import { createAdminConsoleRouter as createRouter } from "./route.js";
import { AdminConsoleService } from "./service.js";
import { SqliteAdminConsoleRepository } from "./sqliteRepository.js";

export function createAdminConsoleRouter() {
  return createRouter(new AdminConsoleService(new SqliteAdminConsoleRepository(db)));
}
