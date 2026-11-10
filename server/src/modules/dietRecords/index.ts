import { db } from "../../storage/db.js";
import { createDietRecordsRouter } from "./route.js";
import { DietRecordsService } from "./service.js";
import { SqliteDietRecordsRepository } from "./sqliteRepository.js";

const repository = new SqliteDietRecordsRepository(db);
const service = new DietRecordsService(repository);

export default createDietRecordsRouter(service);
