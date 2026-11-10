import { db } from "../../storage/db.js";
import { createHouseholdsRouter as createRouter } from "./route.js";
import { HouseholdsService } from "./service.js";
import { SqliteHouseholdsRepository } from "./sqliteRepository.js";

export function createHouseholdsRouter() {
  return createRouter(new HouseholdsService(new SqliteHouseholdsRepository(db)));
}
