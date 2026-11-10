import { db } from "../../storage/db.js";
import { createMealPlansRouter } from "./route.js";
import { MealPlansService } from "./service.js";
import { SqliteMealPlansRepository } from "./sqliteRepository.js";

const repository = new SqliteMealPlansRepository(db);
const service = new MealPlansService(repository);

export default createMealPlansRouter(service);
