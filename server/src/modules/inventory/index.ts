import { db } from "../../storage/db.js";
import { createInventoryRouter } from "./route.js";
import { InventoryService } from "./service.js";
import { SqliteInventoryRepository } from "./sqliteRepository.js";

const repository = new SqliteInventoryRepository(db);
const service = new InventoryService(repository);

export default createInventoryRouter(service);
