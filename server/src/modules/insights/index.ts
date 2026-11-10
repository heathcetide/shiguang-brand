import { db } from "../../storage/db.js";
import { createInsightsRouter } from "./route.js";
import { InsightsService } from "./service.js";
import { SqliteInsightsRepository } from "./sqliteRepository.js";

const repository = new SqliteInsightsRepository(db);
const service = new InsightsService(repository);

export default createInsightsRouter(service);
