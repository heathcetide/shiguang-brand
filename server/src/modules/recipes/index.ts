import { KitchenwareService } from "../kitchenware/service.js";
import { SqliteKitchenwareRepository } from "../kitchenware/sqliteRepository.js";
import { createRecipesRouter } from "./route.js";
import { RecipesService } from "./service.js";
import { SqliteRecipesRepository } from "./sqliteRepository.js";

export function createRecipesModule(database: ConstructorParameters<typeof SqliteRecipesRepository>[0]) {
  const kitchenware = new KitchenwareService(new SqliteKitchenwareRepository(database));
  return createRecipesRouter(new RecipesService(new SqliteRecipesRepository(database), kitchenware));
}
