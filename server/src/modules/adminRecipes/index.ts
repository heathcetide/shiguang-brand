import { db } from "../../storage/db.js";
import { KitchenwareService } from "../kitchenware/service.js";
import { SqliteKitchenwareRepository } from "../kitchenware/sqliteRepository.js";
import { createAdminRecipesRouter as createRouter } from "./route.js";
import { AdminRecipesService } from "./service.js";
import { SqliteAdminRecipesRepository } from "./sqliteRepository.js";

export function createAdminRecipesRouter() {
  return createRouter(new AdminRecipesService(
    new SqliteAdminRecipesRepository(db),
    new KitchenwareService(new SqliteKitchenwareRepository(db)),
  ));
}
