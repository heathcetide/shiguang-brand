import { db } from "../../storage/db.js";
import { createAdminVoicePackRouter as createAdmin } from "./adminRoute.js";
import { createVoicePacksRouter } from "./route.js";
import { VoicePacksService } from "./service.js";
import { SqliteVoicePacksRepository } from "./sqliteRepository.js";
const service = new VoicePacksService(new SqliteVoicePacksRepository(db));
export const createAdminVoicePackRouter = () => createAdmin(service);
export { parseVoicePackCatalog } from "./manifest.js";
export default createVoicePacksRouter(service);
