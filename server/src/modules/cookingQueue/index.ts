import { db } from "../../storage/db.js";
import { createCookingQueueRouter } from "./route.js";
import { CookingQueueService } from "./service.js";
import { SqliteCookingQueueRepository } from "./sqliteRepository.js";

const repository = new SqliteCookingQueueRepository(db);
const service = new CookingQueueService(repository);

export default createCookingQueueRouter(service);
