import { searchFoodUSDA } from "../../services/foodApiAdapter.js";
import { db } from "../../storage/db.js";
import { createFoodRouter } from "./route.js";
import { FoodService } from "./service.js";
import { SqliteFoodRepository } from "./sqliteRepository.js";

const repository = new SqliteFoodRepository(db);
const service = new FoodService(repository, { searchExternal: searchFoodUSDA });

export default createFoodRouter(service);
