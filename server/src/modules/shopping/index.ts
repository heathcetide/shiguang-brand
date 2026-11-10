import { db } from "../../storage/db.js";
import { createShoppingRouter } from "./route.js";
import { ShoppingService } from "./service.js";
import { SqliteShoppingRepository } from "./sqliteRepository.js";

const repository = new SqliteShoppingRepository(db);
const service = new ShoppingService(repository);

export default createShoppingRouter(service);
