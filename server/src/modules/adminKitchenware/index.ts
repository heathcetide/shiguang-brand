import { db } from "../../storage/db.js";
import { createAdminKitchenwareRouter as createRouter } from "./route.js";
import { AdminKitchenwareService } from "./service.js";
import { SqliteAdminKitchenwareRepository } from "./sqliteRepository.js";

export function createAdminKitchenwareRouter() {
  return createRouter(new AdminKitchenwareService(new SqliteAdminKitchenwareRepository(db)));
}
