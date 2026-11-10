import { db } from "../../storage/db.js";
import { createHealthRouter } from "./route.js";
import { HealthService } from "./service.js";
import { SqliteHealthRepository } from "./sqliteRepository.js";

const repository = new SqliteHealthRepository(db);
const service = new HealthService(repository);

export default createHealthRouter(service);
