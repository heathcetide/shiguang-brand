import { createKitchenwareRouter } from "./route.js";
import { KitchenwareService } from "./service.js";
import { SqliteKitchenwareRepository } from "./sqliteRepository.js";

export function createKitchenwareModule(database: ConstructorParameters<typeof SqliteKitchenwareRepository>[0]) {
  return createKitchenwareRouter(new KitchenwareService(new SqliteKitchenwareRepository(database)));
}
