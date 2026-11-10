import { db } from "../../storage/db.js";
import { createAdminFoodAssetsRouter as createRouter } from "./route.js";
import { AdminFoodAssetsService } from "./service.js";
import { SqliteAdminFoodAssetsRepository } from "./sqliteRepository.js";

export function createAdminFoodAssetsRouter() {
  return createRouter(new AdminFoodAssetsService(new SqliteAdminFoodAssetsRepository(db)));
}
